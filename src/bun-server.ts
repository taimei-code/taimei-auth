import type { Layer } from "effect";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { buildApp } from "./app";
import { bootInMemory } from "./boot";
import type { EmailSender } from "./email/ports";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { proxyTrustFromEnv } from "./request-context";
import { initBunSentry } from "./sentry-bun";

const WEB_DIST = "./web/dist";

export const startBunServer = (
  options: { emailSender?: Layer.Layer<EmailSender>; extend?: (app: Hono) => void } = {},
) => {
  initBunSentry();
  bootInMemory(options.emailSender);

  if (process.env.APP_ENV === "production" && !process.env.AUTH_SERVICE_KEY) {
    console.error("FATAL: AUTH_SERVICE_KEY is required in production.");
    process.exit(1);
  }

  if (proxyTrustFromEnv()._tag === "Unconfigured") {
    console.error(
      "FATAL: AUTH_TRUSTED_PROXY_HOPS (non-negative integer) is required in production.",
    );
    process.exit(1);
  }

  const spaFallback = buildSpaFallbackHandler(`${WEB_DIST}/index.html`);
  const app = buildApp({
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
  options.extend?.(app);

  const port = Number(process.env.PORT) || 3100;
  console.log(`auth-service listening on port ${port}`);
  return { app, server: { port, fetch: app.fetch } };
};
