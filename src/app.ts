import { Effect } from "effect";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { HealthRepo } from "./health/ports";
import { Redis } from "./redis-service";
import { handleRpc } from "./rpc/fetch-handler";
import { loginShortcut } from "./handlers/login-shortcut";
import { accountAvatar } from "./handlers/avatar-upload";
import { accountCompany } from "./handlers/account-company";
import { accountInvitation } from "./handlers/account-invitation";
import { accountMembership } from "./handlers/account-membership";
import { accountMfa } from "./handlers/account-mfa";
import { canaryToken } from "./handlers/canary-token";
import { mfaChallenge } from "./handlers/mfa-challenge";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { runMiddleware, runRoute } from "./handlers/run-route";
import { captureThrown, internalErrorResponse } from "./handlers/wire-error";
import { createRateLimitMiddleware, magicLinkKey, mfaAttemptKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { getValidServiceKeys } from "./service-key";
import { getTrustedOrigins, isLocalEnvironment } from "./env";

export type AppOptions = {
  // catch-all (SPA fallback) を含むため、共有ルートをすべて登録した後に呼ぶ。
  mountStatic: (app: Hono) => void;
};

export function mountAccountRoutes(app: Hono): void {
  app.route("/", accountAvatar);
  app.route("/", accountCompany);
  app.route("/", accountInvitation);
  app.route("/", accountMembership);
  app.route("/", accountMfa);
}

const LOCAL_RELAXED_LIMIT = 1000;

const requireServiceKey: MiddlewareHandler = (c, next) =>
  runMiddleware(
    c,
    next,
    Effect.sync(() => {
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
        return undefined;
      }
      if (!serviceKey || !acceptedServiceKeys.includes(serviceKey)) {
        return c.json({ error: "Unauthorized: invalid service key" }, 401);
      }
      return undefined;
    }),
  );

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

  app.all(
    "/rpc/*",
    async (c) => (await handleRpc(c.req.raw)) ?? c.json({ error: "Not Found" }, 404),
  );

  app.route("/", loginShortcut);

  const isLocal = isLocalEnvironment();

  // 無認証で Sentry を直叩きするため、連打による quota 枯渇 (検知チャネルの盲目化) を IP 単位で抑える。
  app.use(
    "/auth/canary-token/*",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:canary:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
      windowSec: 60,
    }),
  );
  app.route("/", canaryToken);

  // plugin の試行制限はチャレンジ / アカウント単位のみで、取り直しながら別アカウントを試す形を IP 軸で塞ぐ。
  app.use(
    "/api/mfa/challenge/verify",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:mfa-challenge:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
      windowSec: 60,
    }),
  );

  app.use(
    "/api/mfa/challenge",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:mfa-challenge-status:ip:${getClientContext(c.req.raw.headers).ip}`,
      // 未認証で到達し challenge cookie ありで Redis 3 往復。30 = 表示 1 + verify 上限 10 の数人分 (NAT 同居)。
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 30,
      windowSec: 60,
    }),
  );
  app.route("/", mfaChallenge);

  app.use(
    "/api/auth/sign-in/magic-link",
    createRateLimitMiddleware({
      keyFn: (c) => magicLinkKey("ip", getClientContext(c.req.raw.headers).ip),
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 5,
      windowSec: 60,
    }),
    createRateLimitMiddleware({
      keyFn: async (c) => {
        // workerd は body の clone 二重読みで hang するため、ここで raw body を Hono cache に先読みさせる。
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

  // GET/POST 以外に広げ忘れると static fallback に落ちて 200 HTML が返り silent に壊れる。
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const body = c.req.method === "GET" ? undefined : await c.req.arrayBuffer();
    const request =
      body === undefined
        ? c.req.raw
        : new Request(c.req.raw.url, {
            method: c.req.method,
            headers: c.req.raw.headers,
            body: body.byteLength ? body : undefined,
          });
    return auth.handler(request).catch((error: unknown) => {
      captureThrown(error, "better-auth");
      return internalErrorResponse();
    });
  });

  // wildcard にしないのは前置 path 自身にも match し状態参照まで 429 に巻き込むため (実測)。
  const mfaAttemptRateLimit = createRateLimitMiddleware({
    keyFn: (c) => mfaAttemptKey(c.req.raw.headers, getClientContext(c.req.raw.headers).ip),
    limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
    windowSec: 60,
  });
  app.use("/api/account/mfa/enroll", mfaAttemptRateLimit);
  app.use("/api/account/mfa/activate", mfaAttemptRateLimit);
  app.use("/api/account/mfa/disable", mfaAttemptRateLimit);

  mountAccountRoutes(app);

  // session-aware redirect は静的配信より前に登録する。
  app.use("/auth/*", authEntryRedirect);

  app.get("/health", (c) =>
    runRoute(
      c,
      Effect.gen(function* () {
        const health = yield* HealthRepo;
        const redis = yield* Redis;
        const [dbOk, redisOk] = yield* Effect.all(
          [
            health.pingDatabase().pipe(Effect.orElseSucceed(() => false)),
            redis.ping().pipe(Effect.orElseSucceed(() => false)),
          ],
          { concurrency: "unbounded" },
        );
        const checks = { db: dbOk ? "ok" : "error", redis: redisOk ? "ok" : "error" };
        const healthy = dbOk && redisOk;
        const version = process.env.CF_VERSION_ID ?? null;
        return c.json(
          { status: healthy ? "ok" : "degraded", checks, version },
          healthy ? 200 : 503,
        );
      }),
    ),
  );

  options.mountStatic(app);

  return app;
}
