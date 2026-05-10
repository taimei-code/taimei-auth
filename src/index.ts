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
import { canaryToken } from "./handlers/canary-token";
import { authEntryRedirect } from "./handlers/auth-entry-redirect";
import { buildSpaFallbackHandler } from "./handlers/spa-fallback";
import { initSentry } from "./sentry";

initSentry();
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

const app = new Hono();

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
  const expectedKey = process.env.AUTH_SERVICE_KEY;

  if (!expectedKey) {
    console.warn("AUTH_SERVICE_KEY is not configured. Skipping service auth.");
    return next();
  }

  if (serviceKey !== expectedKey) {
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

app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

app.post("/api/account/avatar/upload-token", avatarUploadHandler);

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
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const healthy = checks.db === "ok" && checks.redis === "ok";
  return c.json({ status: healthy ? "ok" : "degraded", checks }, healthy ? 200 : 503);
});

await connectRedis();

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
