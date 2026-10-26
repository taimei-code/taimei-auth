import type { Layer } from "effect";
import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { EmailSender } from "../src/email/ports";
import { initBunSentry } from "./sentry-bun";
import { buildApp } from "../src/app";
import { boot } from "../src/boot";
import { buildSpaFallbackHandler } from "./spa-fallback";
import { withClientIp } from "../src/client-ip";
import { type ProxyTrust, resolveForwardedClientIp } from "../src/request-context";
import type { TtlStoreBackend } from "../src/ttl-store";

const WEB_DIST = "./web/dist";

export const startBunServer = (options: {
  emailSender?: Layer.Layer<EmailSender>;
  ttlStore: TtlStoreBackend;
  proxyTrust: Exclude<ProxyTrust, { _tag: "Unconfigured" }>;
  extendBeforeStatic?: (app: Hono) => void;
}) => {
  initBunSentry();
  boot(options.ttlStore, options.emailSender);

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

  const fetch = (request: Request) =>
    app.fetch(withClientIp(request, resolveForwardedClientIp(request.headers, options.proxyTrust)));

  return { app, server: { port, fetch } };
};
