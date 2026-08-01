import { Hono } from "hono";
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
import { canaryToken } from "./handlers/canary-token";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { createRateLimitMiddleware, magicLinkKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { getValidServiceKeys } from "./service-key";
import { getTrustedOrigins, isLocalEnvironment } from "./env";

// Bun entry (index.ts) と Workers entry (worker.ts) が共有する Hono アプリ定義。
// runtime 固有なのは「静的配信」のみ (Bun = serveStatic+Bun.file / Workers = env.ASSETS) で、
// それを mountStatic コールバックで最後に受ける。RPC は両 runtime とも fetch ハンドラ直配信し、
// connect-node の内部 http proxy は使わない (ADR-0011)。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
export type AppOptions = {
  // 共有ルートをすべて登録した後に、静的配信ルート (+ SPA fallback / catch-all) を登録する。
  // 静的配信は runtime 固有のため呼び出し側 entry が渡す。
  mountStatic: (app: Hono) => void;
};

// account router 群の登録を 1 箇所に集約する。認可 smoke (account-routes-auth.test.ts) が同じ helper で
// アプリを組むことで、router の追加漏れ (guard 未通過 route の混入) を CI で検知できる。
export function mountAccountRoutes(app: Hono): void {
  app.route("/", accountAvatar);
  app.route("/", accountCompany);
  app.route("/", accountInvitation);
  app.route("/", accountMembership);
}

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

  // ConnectRPC の X-Service-Key 検証。
  app.use("/rpc/*", async (c, next) => {
    const serviceKey = c.req.header("X-Service-Key");
    const acceptedServiceKeys = getValidServiceKeys();
    if (acceptedServiceKeys.length === 0) {
      // production の fail-fast は entry 側 (index.ts) の起動時 process.exit。
      // ここに到達するのは dev / test のみ。二重防御として production だけ 503 を返す。
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
  });

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

  // canary は無認証で Sentry captureMessage を直叩きする endpoint のため、連打による
  // Sentry quota 枯渇 (= 攻撃検知チャネル自体の盲目化) を IP 単位で抑える。
  // 正規の発火は攻撃者が canary を踏んだ瞬間のみで頻度は稀なため 10/IP/min で十分。
  // local の緩和は magic-link rate limit と同方針。
  app.use(
    "/auth/canary-token/*",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:canary:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? 1000 : 10,
      windowSec: 60,
    }),
  );
  app.route("/", canaryToken);

  // Magic Link 経路のみ IP + email の 2 軸で rate limit。
  // production: 5/IP/min + 3/email/min。local (dev / e2e): 1000/IP/min + 1000/email/min。
  // better-auth 内蔵 rateLimit (auth.ts) と同じ緩和方針で揃える。
  app.use(
    "/api/auth/sign-in/magic-link",
    createRateLimitMiddleware({
      keyFn: (c) => magicLinkKey("ip", getClientContext(c.req.raw.headers).ip),
      limit: isLocal ? 1000 : 5,
      windowSec: 60,
    }),
    createRateLimitMiddleware({
      keyFn: async (c) => {
        // workerd は request body の clone 二重読み (rate-limit の clone + better-auth) で hang する。
        // この json() は email を取りつつ raw body を Hono cache に先読みさせる役割で、
        // 後段 auth.handler へ渡す Request は下の "/api/auth/*" で同 cache (arrayBuffer) から再構築する。
        const body = await c.req
          .json<Record<string, unknown>>()
          .catch(() => ({}) as Record<string, unknown>);
        const email = typeof body?.email === "string" ? body.email : "unknown";
        return magicLinkKey("email", email);
      },
      limit: isLocal ? 1000 : 3,
      windowSec: 60,
    }),
  );

  // Hono v4 の wildcard は末尾 `*` で multi-segment を catch する (`/api/auth/**` ではない)。
  // GET/POST のみ better-auth に渡す (本アプリが使う magic-link / sign-out / get-session / callback は
  // すべて GET か POST)。将来 better-auth が DELETE/PATCH route を増やしたらここを広げる
  // — でないと static fallback に落ちて 200 HTML が返り silent に壊れる。
  // rate-limit middleware が body を Hono cache に載せているため、raw を直接渡すと body が空になる。
  // POST は cache 済み body を buffer して fresh Request を better-auth に渡す。
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

  // 静的配信 (+ SPA fallback / catch-all) は runtime 固有。最後に登録する。
  options.mountStatic(app);

  return app;
}
