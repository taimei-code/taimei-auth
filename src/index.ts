import { serveStatic } from "hono/bun";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "./app";
import { initAuth } from "./auth";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { proxyTrustFromEnv } from "./request-context";
import { getRuntime } from "./runtime";

initBunSentry();
initAuth(getRuntime());

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

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
