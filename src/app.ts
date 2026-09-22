import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { handleRpc } from "./rpc/fetch-handler";
import { loginShortcut } from "./handlers/login-shortcut";
import { accountAvatar } from "./handlers/avatar-upload";
import { accountCompany } from "./handlers/account-company";
import { accountInvitation } from "./handlers/account-invitation";
import { accountMembership } from "./handlers/account-membership";
import { accountMfa } from "./handlers/account-mfa";
import { canaryToken } from "./handlers/canary-token";
import { health } from "./handlers/health";
import { mfaChallenge } from "./handlers/mfa-challenge";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { runMiddleware } from "./handlers/run-route";
import {
  captureThrown,
  internalErrorResponse,
  clientFacingErrorResponse,
} from "./handlers/client-facing-error";
import { createRateLimitMiddleware, magicLinkKey, mfaAttemptKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { verifyServiceKey } from "./service-key";
import { getTrustedOrigins, isLocalEnvironment } from "./env";

export type AppOptions = {
  // catch-all を含むので、共有 route を登録し終えてから呼ぶ。
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
    runMiddleware(c, next, verifyServiceKey(c.req.header("X-Service-Key"))),
  );

  app.all(
    "/rpc/*",
    async (c) =>
      (await handleRpc(c.req.raw)) ??
      clientFacingErrorResponse({ error: "Not Found", status: 404 }),
  );

  app.route("/", loginShortcut);

  const isLocal = isLocalEnvironment();

  // 認証なしで Sentry に直送するため、連打で quota が尽きないよう IP 単位で抑える。
  app.use(
    "/auth/canary-token/*",
    createRateLimitMiddleware({
      keyFn: (c) => `rate-limit:canary:ip:${getClientContext(c.req.raw.headers).ip}`,
      limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
      windowSec: 60,
    }),
  );
  app.route("/", canaryToken);

  // plugin の試行制限はチャレンジ単位とアカウント単位だけなので、別アカウント総当たりを IP 単位で防ぐ。
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
      // 30 は表示 1 回 + verify 上限 10 回を NAT 同居の数人分と見た値。
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
        // workerd は body を clone して二重に読むと hang するため、raw body を Hono の cache に先読みさせる。
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

  // wildcard にすると前置パス自身にも一致し、状態参照まで 429 になる (実測)。
  const mfaAttemptRateLimit = createRateLimitMiddleware({
    keyFn: (c) => mfaAttemptKey(c.req.raw.headers, getClientContext(c.req.raw.headers).ip),
    limit: isLocal ? LOCAL_RELAXED_LIMIT : 10,
    windowSec: 60,
  });
  app.use("/api/account/mfa/enroll", mfaAttemptRateLimit);
  app.use("/api/account/mfa/activate", mfaAttemptRateLimit);
  app.use("/api/account/mfa/disable", mfaAttemptRateLimit);

  mountAccountRoutes(app);

  app.use("/auth/*", authEntryRedirect);

  app.route("/", health);

  options.mountStatic(app);

  return app;
}
