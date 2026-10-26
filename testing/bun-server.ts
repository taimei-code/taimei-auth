import type { Layer } from "effect";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { EmailSender } from "../src/email/ports";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "../src/app";
import { boot, bootInMemory } from "../src/boot";
import { buildSpaFallbackHandler } from "../src/handlers/spa-fallback";
import { proxyTrustFromEnv } from "../src/request-context";
import type { TtlStoreBackend } from "../src/ttl-store";

const WEB_DIST = "./web/dist";

export const startBunServer = (
  options: {
    emailSender?: Layer.Layer<EmailSender>;
    ttlStore?: TtlStoreBackend;
    extendBeforeStatic?: (app: Hono) => void;
  } = {},
) => {
  initBunSentry();
  if (options.ttlStore) boot(options.ttlStore, options.emailSender);
  else bootInMemory(options.emailSender);

  if (!process.env.AUTH_SERVICE_KEY) {
    console.error("FATAL: AUTH_SERVICE_KEY is required.");
    process.exit(1);
  }

  if (proxyTrustFromEnv()._tag === "Unconfigured") {
    console.error("FATAL: AUTH_TRUSTED_PROXY_HOPS (non-negative integer) is required.");
    process.exit(1);
  }

  const spaFallback = buildSpaFallbackHandler(`${WEB_DIST}/index.html`);

  const app = buildApp({
    mountStatic: (honoApp) => {
      options.extendBeforeStatic?.(honoApp);
      honoApp.use(
        "/auth/*",
        serveStatic({
          root: WEB_DIST,
          rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
        }),
      );
      honoApp.get("*", spaFallback);
    },
  });

  const port = Number(process.env.PORT) || 3100;
  console.log(`auth-service listening on port ${port}`);

  return { app, server: { port, fetch: app.fetch } };
};
