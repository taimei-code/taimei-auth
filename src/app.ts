import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { handleRpc } from "./rpc/fetch-handler";
import { loginShortcut } from "./handlers/login-shortcut";
import { canaryToken } from "./handlers/canary-token";
import { health } from "./handlers/health";
import { mountSpaApi } from "./handlers/spa-http-api";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { CONTINUE, runMiddleware, runRoute } from "./handlers/run-route";
import { captureThrown, internalErrorResponse } from "./handlers/client-facing-error";
import { NotFound } from "./membership/guard/errors";
import { createRateLimitMiddleware, limitForEnvironment, magicLinkKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { verifyServiceKey } from "./service-key";
import { getTrustedOrigins } from "./env";

export type AppOptions = {
  // catch-all を含むので、共有 route を登録し終えてから呼ぶ。
  mountStatic: (app: Hono) => void;
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

  app.use("/rpc/*", (c, next) =>
    runMiddleware(
      c,
      next,
      verifyServiceKey(c.req.header("X-Service-Key")).pipe(Effect.as(CONTINUE)),
    ),
  );

  app.all("/rpc/*", async (c) => (await handleRpc(c.req.raw)) ?? runRoute(c, new NotFound()));

  app.route("/", loginShortcut);

  // 認証なしで Sentry に直送するため、連打で quota が尽きないよう IP 単位で抑える。
  app.use(
    "/auth/canary-token/*",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:canary:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: limitForEnvironment(10),
      windowSec: 60,
    }),
  );
  app.route("/", canaryToken);

  app.use(
    "/api/auth/sign-in/magic-link",
    createRateLimitMiddleware({
      keyFn: (c) => magicLinkKey("ip", getClientContext(c.req.raw.headers).ip),
      limit: limitForEnvironment(5),
      windowSec: 60,
    }),
    createRateLimitMiddleware({
      keyFn: async (c) => {
        // workerd は body を clone して二重に読むと hang するため、raw body を Hono の cache に先読みさせる。
        const body = await c.req
          .json<Record<string, unknown>>()
          .catch(() => ({}) as Record<string, unknown>);
        const email = typeof body?.email === "string" ? body.email : "unknown";
        return magicLinkKey("email", email);
      },
      limit: limitForEnvironment(3),
      windowSec: 60,
    }),
  );

  // method を広げ忘れると static fallback が 200 の HTML を返し、気付かれない。
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

  mountSpaApi(app);

  app.use("/auth/*", authEntryRedirect);

  app.route("/", health);

  options.mountStatic(app);

  return app;
}
