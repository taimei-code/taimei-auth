import { Effect } from "effect";
import { type Context, Hono } from "hono";
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

async function readEmailWithoutCloningBody(c: Context): Promise<string> {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  return typeof body?.email === "string" ? body.email : "unknown";
}

export const BETTER_AUTH_METHODS = ["GET", "POST"] as const;

export type AppOptions = {
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
      keyFn: async (c) => magicLinkKey("email", await readEmailWithoutCloningBody(c)),
      limit: limitForEnvironment(3),
      windowSec: 60,
    }),
  );

  app.on([...BETTER_AUTH_METHODS], "/api/auth/*", async (c) => {
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
