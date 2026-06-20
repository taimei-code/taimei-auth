import { serveStatic } from "hono/bun";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "./app";
import { connectRedis } from "./redis";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";

initBunSentry();

// production で AUTH_SERVICE_KEY 未設定なら起動拒否。
// dev / test 環境では従来通り warn のみで通す (compose の local-dev-key を hardcoded する運用も維持)。
if (process.env.APP_ENV === "production" && !process.env.AUTH_SERVICE_KEY) {
  console.error("FATAL: AUTH_SERVICE_KEY is required in production.");
  process.exit(1);
}

const WEB_DIST = "./web/dist";
const spaFallback = buildSpaFallbackHandler(`${WEB_DIST}/index.html`);

// `app` は test (routes-integration.test.ts) から import するため named export する。
// 共有ルートは buildApp、Bun 固有の静的配信 (serveStatic + Bun.file SPA fallback) のみ mountStatic で渡す。
export const app = buildApp({
  mountStatic: (app) => {
    app.use(
      "/auth/*",
      serveStatic({
        root: WEB_DIST,
        rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
      }),
    );
    app.get("/auth/*", spaFallback);
    app.get("/account/*", spaFallback);
  },
});

await connectRedis();

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
