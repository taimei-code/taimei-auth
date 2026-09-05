import { Effect } from "effect";
import { serveStatic } from "hono/bun";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "./app";
import { pingRedis } from "./redis";
import { getRuntime } from "./runtime";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { parseTrustedProxyHops } from "./request-context";

initBunSentry();

// production で AUTH_SERVICE_KEY 未設定なら起動拒否 (dev / test は warn のみで通す)。
if (process.env.APP_ENV === "production" && !process.env.AUTH_SERVICE_KEY) {
  console.error("FATAL: AUTH_SERVICE_KEY is required in production.");
  process.exit(1);
}

// 未設定を既定値で埋めると client IP が "unknown" に潰れ、audit も IP 軸 rate-limit も無価値化する。
// Workers 本番はこの entry を通らないため設定不要 (request-context.ts)。
const trustedProxyHopsConfigured =
  parseTrustedProxyHops(process.env.AUTH_TRUSTED_PROXY_HOPS) !== null;
if (process.env.APP_ENV === "production" && !trustedProxyHopsConfigured) {
  console.error("FATAL: AUTH_TRUSTED_PROXY_HOPS (non-negative integer) is required in production.");
  process.exit(1);
}

const WEB_DIST = "./web/dist";
const spaFallback = buildSpaFallbackHandler(`${WEB_DIST}/index.html`);

// `app` は test (routes-integration.test.ts) から import するため named export する。
export const app = buildApp({
  mountStatic: (honoApp) => {
    honoApp.use(
      "/auth/*",
      serveStatic({
        root: WEB_DIST,
        rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
      }),
    );
    honoApp.get("/auth/*", spaFallback);
    honoApp.get("/account/*", spaFallback);
  },
});

// compose / CI は healthcheck で redis 先行起動済みのため通常は数十 ms で返る。
const REDIS_BOOT_TIMEOUT_MS = 10_000;

// session 実体と rate-limit が Redis 前提のため、疎通不能なら「起動はしたが認証できない」プロセスを
// 作らず boot で止める。timeout による打ち切りは必須 — redis 断のとき ping は resolve しない。
// Redis service の ping は /health 向けに 2s で切るため、10s 待つ boot は生の pingRedis に timeout を掛ける
// (ADR-0017 Decision の非同期項「Bun 起動の Redis ping 10s」)。
const redisReachable = await getRuntime().runPromise(
  Effect.promise(() => pingRedis()).pipe(
    Effect.timeout(REDIS_BOOT_TIMEOUT_MS),
    Effect.orElseSucceed(() => false),
  ),
);
if (!redisReachable) {
  console.error("FATAL: Redis is unreachable at boot.");
  process.exit(1);
}

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
