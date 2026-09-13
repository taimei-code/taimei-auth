import { Effect } from "effect";
import { serveStatic } from "hono/bun";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "./app";
import { pingRedis } from "./redis";
import { getRuntime } from "./runtime";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { proxyTrustFromEnv } from "./request-context";

initBunSentry();

// 未設定のまま起動すると /rpc/* の service key 検査が skip され誰でも叩けるため production では止める。
if (process.env.APP_ENV === "production" && !process.env.AUTH_SERVICE_KEY) {
  console.error("FATAL: AUTH_SERVICE_KEY is required in production.");
  process.exit(1);
}

if (proxyTrustFromEnv()._tag === "Unconfigured") {
  console.error("FATAL: AUTH_TRUSTED_PROXY_HOPS (non-negative integer) is required in production.");
  process.exit(1);
}

const WEB_DIST = "./web/dist";
const spaFallback = buildSpaFallbackHandler(`${WEB_DIST}/index.html`);

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

const REDIS_BOOT_TIMEOUT_MS = 10_000;

// timeout による打ち切りは必須 — redis 断のとき ping は resolve しない。
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
