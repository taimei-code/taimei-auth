import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "./auth";
import { pingDatabase } from "@/db/repositories/health";
import { pingRedis } from "./redis";
import { handleRpc } from "./rpc/fetch-handler";
import { buildLoginShortcut } from "./handlers/login-shortcut";
import { accountAvatar } from "./handlers/avatar-upload";
import { accountCompany } from "./handlers/account-company";
import { accountInvitation } from "./handlers/account-invitation";
import { accountMembership } from "./handlers/account-membership";
import { accountMfa } from "./handlers/account-mfa";
import { canaryToken } from "./handlers/canary-token";
import { mfaChallenge } from "./handlers/mfa-challenge";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { createRateLimitMiddleware, magicLinkKey, mfaAttemptKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { getValidServiceKeys } from "./service-key";
import { getTrustedOrigins, isLocalEnvironment } from "./env";

// Bun entry (index.ts) と Workers entry (worker.ts) が共有する composition root。runtime 固有なのは
// 静的配信のみで mountStatic で受ける。RPC は両 runtime とも fetch ハンドラ直配信 (詳細: ADR-0011)。
export type AppOptions = {
  // catch-all (SPA fallback) を含むため、共有ルートをすべて登録した後に呼ぶ。
  mountStatic: (app: Hono) => void;
};

// 認可 smoke (account-routes-auth.test.ts) が同じ helper で組み、guard 未通過 route の混入を CI で検知する。
export function mountAccountRoutes(app: Hono): void {
  app.route("/", accountAvatar);
  app.route("/", accountCompany);
  app.route("/", accountInvitation);
  app.route("/", accountMembership);
  app.route("/", accountMfa);
}

// local (dev / e2e) は同一 key 連投が常態で、production limit だと自テストが 429 を踏むため緩める。
const LOCAL_RELAXED_LIMIT = 1000;

const requireServiceKey: MiddlewareHandler = async (c, next) => {
  const serviceKey = c.req.header("X-Service-Key");
  const acceptedServiceKeys = getValidServiceKeys();
  if (acceptedServiceKeys.length === 0) {
    // production の fail-fast は entry 側 (index.ts) の起動時 process.exit。ここは二重防御。
    if (process.env.APP_ENV === "production") {
      return c.json({ error: "Service Key not configured (production)" }, 503);
    }
    console.warn(
      "AUTH_SERVICE_KEY is not configured. Skipping service auth (non-production only).",
    );
    return next();
  }
  if (!serviceKey || !acceptedServiceKeys.includes(serviceKey)) {
    return c.json({ error: "Unauthorized: invalid service key" }, 401);
  }
  return next();
};

export function buildApp(options: AppOptions): Hono {
  const app = new Hono();

  const allowedOrigins = getTrustedOrigins();
  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Service-Key", "Connect-Protocol-Version"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.use("/rpc/*", requireServiceKey);

  // RPC は fetch ハンドラ直配信。マッチしなければ後段へは渡さず 404。
  app.all(
    "/rpc/*",
    async (c) => (await handleRpc(c.req.raw)) ?? c.json({ error: "Not Found" }, 404),
  );

  const loginShortcut = buildLoginShortcut(async (headers) => {
    // `/` は最も hot な entry。Cookie 不在なら Redis/DB を叩かず未認証確定で latency を削る。
    if (!getSessionCookie(headers)) return false;
    const result = await auth.api.getSession({ headers });
    return result !== null;
  });
  app.route("/", loginShortcut);

  const isLocal = isLocalEnvironment();

  // canary は無認証で Sentry captureMessage を直叩きするため、連打による quota 枯渇 (= 攻撃検知
  // チャネル自体の盲目化) を IP 単位で抑える。正規の発火は稀なので 10/IP/min で十分。
  app.use(
    "/auth/canary-token/*",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:canary:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
      windowSec: 60,
    }),
  );
  app.route("/", canaryToken);

  // プラグインの試行制限はチャレンジ単位とアカウント単位しか数えず、チャレンジを取り直しながら
  // 別アカウントを順に試す形は素通りする。その穴を IP 軸で塞ぐ。
  app.use(
    "/api/mfa/challenge/verify",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:mfa-challenge:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
      windowSec: 60,
    }),
  );

  // 状態取得も未認証で到達でき、チャレンジ cookie 付きなら Redis 3 往復を引くため IP 単位で抑える。
  // 正規利用の上限は初回表示 1 + verify 上限 10 = 11 回/分で、同一 NAT 配下の数人分を足して 30。
  app.use(
    "/api/mfa/challenge",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:mfa-challenge-status:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 30,
      windowSec: 60,
    }),
  );
  app.route("/", mfaChallenge);

  // Magic Link 経路のみ IP + email の 2 軸で rate limit (production: 5/IP/min + 3/email/min)。
  app.use(
    "/api/auth/sign-in/magic-link",
    createRateLimitMiddleware({
      keyFn: (c) => magicLinkKey("ip", getClientContext(c.req.raw.headers).ip),
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 5,
      windowSec: 60,
    }),
    createRateLimitMiddleware({
      keyFn: async (c) => {
        // workerd は request body の clone 二重読み (rate-limit + better-auth) で hang する。この json()
        // は email を取りつつ raw body を Hono cache に先読みさせ、後段は同 cache から Request を再構築する。
        const body = await c.req
          .json<Record<string, unknown>>()
          .catch(() => ({}) as Record<string, unknown>);
        const email = typeof body?.email === "string" ? body.email : "unknown";
        return magicLinkKey("email", email);
      },
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 3,
      windowSec: 60,
    }),
  );

  // GET/POST のみ better-auth に渡す。将来 better-auth が DELETE/PATCH route を増やしたら広げる
  // — でないと static fallback に落ちて 200 HTML が返り silent に壊れる。body は cache から再構築する。
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    if (c.req.method === "GET") return auth.handler(c.req.raw);
    const body = await c.req.arrayBuffer();
    return auth.handler(
      new Request(c.req.raw.url, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: body.byteLength ? body : undefined,
      }),
    );
  });

  // MFA 状態変更 3 route の試行制限 (軸の理由は rate-limit.ts の mfaAttemptKey)。wildcard にしないのは
  // "/api/account/mfa/*" が前置 path 自身にも match し (実測)、状態参照まで 429 に巻き込むため。
  const mfaAttemptRateLimit = createRateLimitMiddleware({
    keyFn: (c) => mfaAttemptKey(c.req.raw.headers, getClientContext(c.req.raw.headers).ip),
    limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
    windowSec: 60,
  });
  app.use("/api/account/mfa/enroll", mfaAttemptRateLimit);
  app.use("/api/account/mfa/activate", mfaAttemptRateLimit);
  app.use("/api/account/mfa/disable", mfaAttemptRateLimit);

  mountAccountRoutes(app);

  // session-aware redirect を静的配信より前に登録する。詳細: docs/adr/0002-spa-routing-and-static-assets.md
  app.use("/auth/*", authEntryRedirect);

  app.get("/health", async (c) => {
    // db/CLAUDE.md ルール 1: drizzle / @/db/client を直接 import せず repository 経由で ping する。
    const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
    const checks = { db: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" };
    const healthy = dbOk && redisOk;
    return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
  });

  options.mountStatic(app);

  return app;
}
