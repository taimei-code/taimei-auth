import * as http from "node:http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "./auth";
import { connectRedis, redis } from "./redis";
import { registerRoutes } from "./rpc/routes";
import { buildProxyHeaders } from "./proxy-helpers";
import { buildLoginShortcut } from "./handlers/login-shortcut";
import { avatarUploadHandler } from "./handlers/avatar-upload";
import { accountCompany } from "./handlers/account-company";
import { accountInvitation } from "./handlers/account-invitation";
import { accountMembership } from "./handlers/account-membership";
import { canaryToken } from "./handlers/canary-token";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { initSentry } from "./sentry";
import { createRateLimitMiddleware, magicLinkKey } from "./rate-limit";
import { getClientContext } from "./request-context";
import { getValidServiceKeys } from "./service-key";
import { isLocalEnvironment } from "./env";

initSentry();
import { pingDatabase } from "@/db/repositories/health";

// production で AUTH_SERVICE_KEY 未設定なら起動拒否。
// dev / test 環境では従来通り warn のみで通す (compose の local-dev-key を hardcoded する運用も維持)。
if (process.env.APP_ENV === "production" && !process.env.AUTH_SERVICE_KEY) {
  console.error("FATAL: AUTH_SERVICE_KEY is required in production.");
  process.exit(1);
}

// `app` は test (routes-integration.test.ts) から import するため named export する。
// `default export` (= bun runtime 起動エントリ) と並行して、test 用に同じ Hono instance を
// 取り出す目的。
export const app = new Hono();

const allowedOrigins = (process.env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean);

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Service-Key", "Connect-Protocol-Version"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.use("/rpc/*", async (c, next) => {
  const serviceKey = c.req.header("X-Service-Key");
  const acceptedServiceKeys = getValidServiceKeys();

  if (acceptedServiceKeys.length === 0) {
    // production 起動時の fail-fast は line 25-28 (process.exit(1))。
    // ここに到達するのは dev / test 環境のみ。二重防御として production だけ 503 を返す。
    if (process.env.APP_ENV === "production") {
      return c.json({ error: "Service Key not configured (production)" }, 503);
    }
    console.warn(
      "AUTH_SERVICE_KEY is not configured. Skipping service auth (non-production only).",
    );
    return next();
  }

  if (!serviceKey || !acceptedServiceKeys.includes(serviceKey)) {
    return c.json({ error: "Unauthorized: invalid service key" }, 401);
  }

  return next();
});

// ConnectRPC は Node.js http に bind し、Hono からプロキシ。詳細: docs/adr/0001-rpc-proxy-content-length.md
const rpcPort = Number(process.env.RPC_INTERNAL_PORT) || 3101;
const rpcHandler = connectNodeAdapter({
  routes: registerRoutes,
  requestPathPrefix: "/rpc",
});
const rpcServer = http.createServer(rpcHandler);
rpcServer.listen(rpcPort, "127.0.0.1", () => {
  console.log(`ConnectRPC handler listening on 127.0.0.1:${rpcPort}`);
});

app.all("/rpc/*", async (c) => {
  const url = new URL(c.req.url);
  const proxyUrl = `http://127.0.0.1:${rpcPort}${url.pathname}`;

  const bodyBuffer = c.req.method !== "GET" ? await c.req.raw.arrayBuffer() : undefined;
  const headers = buildProxyHeaders(c.req.raw.headers, bodyBuffer?.byteLength);

  const proxyRes = await fetch(proxyUrl, {
    method: c.req.method,
    headers,
    body: bodyBuffer,
  });

  return new Response(proxyRes.body, {
    status: proxyRes.status,
    headers: proxyRes.headers,
  });
});

const loginShortcut = buildLoginShortcut(async (headers) => {
  // `/` は最も hot な entry。Cookie 不在なら Redis/DB を叩かず未認証確定で latency を削る
  if (!getSessionCookie(headers)) return false;
  const result = await auth.api.getSession({ headers });
  return result !== null;
});
app.route("/", loginShortcut);

app.route("/", canaryToken);

// Magic Link 経路のみ IP + email の 2 軸で rate limit。
// production: 5/IP/min + 3/email/min。
// local (dev / e2e): 1000/IP/min + 1000/email/min (e2e の連続 signin で 429 を出さない)。
// better-auth 内蔵 rateLimit (auth.ts) の `isLocalEnvironment() ? { window: 1, max: 1000 } : ...`
// と同じ緩和方針で揃える。middleware ロジック自体は local でも通るためテストできる。
const isLocal = isLocalEnvironment();
app.use(
  "/api/auth/sign-in/magic-link",
  createRateLimitMiddleware({
    keyFn: (c) => magicLinkKey("ip", getClientContext(c.req.raw.headers).ip),
    limit: isLocal ? 1000 : 5,
    windowSec: 60,
  }),
  createRateLimitMiddleware({
    // POST body は middleware で消費すると後段 handler が読めなくなるため clone してから読む。
    keyFn: async (c) => {
      const body = await c.req.raw
        .clone()
        .json()
        .catch(() => ({}) as Record<string, unknown>);
      const email = typeof body?.email === "string" ? body.email : "unknown";
      return magicLinkKey("email", email);
    },
    limit: isLocal ? 1000 : 3,
    windowSec: 60,
  }),
);

// Hono v4 の wildcard は `*` が末尾で multi-segment を catch する。
// `/api/auth/**` は文字どおり `* が 2 つ` と解釈され、`/api/auth/sign-in/magic-link` 等の
// nested path に match せず 404 を返していた。
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.post("/api/account/avatar/upload-token", avatarUploadHandler);
app.route("/", accountCompany);
app.route("/", accountInvitation);
app.route("/", accountMembership);

const WEB_DIST = "./web/dist";
const SPA_INDEX_HTML = `${WEB_DIST}/index.html`;
const spaFallback = buildSpaFallbackHandler(SPA_INDEX_HTML);

// session-aware redirect を serveStatic より前に登録する必要がある。詳細: docs/adr/0002-spa-routing-and-static-assets.md
app.use("/auth/*", authEntryRedirect);

app.use(
  "/auth/*",
  serveStatic({
    root: WEB_DIST,
    rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
  }),
);

app.get("/auth/*", spaFallback);
app.get("/account/*", spaFallback);

app.get("/health", async (c) => {
  // db/CLAUDE.md ルール 1: drizzle / @/db/client を直接 import せず repository 経由で ping する。
  // typescript-coding.md ルール: try-catch ではなく then-catch で書く。
  const [dbOk, redisOk] = await Promise.all([
    pingDatabase(),
    redis
      .ping()
      .then(() => true)
      .catch(() => false),
  ]);
  const checks = {
    db: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
  };
  const healthy = dbOk && redisOk;
  return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
});

await connectRedis();

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
