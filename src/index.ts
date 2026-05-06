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
import { initSentry } from "./sentry";

initSentry();
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

const app = new Hono();

// CORS middleware
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

// サービス間認証 middleware（/rpc/* のみ）
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

// ConnectRPC: Node.js http サーバーを内部ポートで起動（Bun の Web API と互換させるため）
const rpcPort = Number(process.env.RPC_INTERNAL_PORT) || 3101;
const rpcHandler = connectNodeAdapter({
  routes: registerRoutes,
  requestPathPrefix: "/rpc",
});
const rpcServer = http.createServer(rpcHandler);
rpcServer.listen(rpcPort, "127.0.0.1", () => {
  console.log(`ConnectRPC handler listening on 127.0.0.1:${rpcPort}`);
});

// Hono → ConnectRPC プロキシ（API Key 認証を通過した後にプロキシ）
// Node.js の connectNodeAdapter は Content-Length 付きリクエストを期待するため、
// Bun の ReadableStream をそのまま転送するとチャンク転送になり 400 を返す。
// 一旦 ArrayBuffer に読み出してから Content-Length 付きで再送する。
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

// /, /login → session 有りで /account, 未認証で /auth/?service_name=accounts&redirect_url=<auth>/account
const loginShortcut = buildLoginShortcut(async (headers) => {
  // Cookie 自体無ければ Redis/DB を叩かずに未認証確定。`/` は最も hot な entry のため、未認証多数派の latency を削る。
  if (!getSessionCookie(headers)) return false;
  const result = await auth.api.getSession({ headers });
  return result !== null;
});
app.route("/", loginShortcut);

// canary token 検知 endpoint (Layer B 画面の 3 種埋込から到達 → Sentry 通報)
app.route("/", canaryToken);

// Better Auth HTTP ハンドラー
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// Vercel Blob client upload の token 発行 endpoint (PR8b)。
// Better Auth Cookie で認証 → 画像のみ + 5MB 上限の signed token を返却。
app.post("/api/account/avatar/upload-token", avatarUploadHandler);

// Layer B: Vite build 出力 (web/dist) を /auth/* に配信。
// vite.config.ts の base="/auth/" と整合。serveStatic で hit しないパス (= SPA route) は
// 後続の SPA fallback ハンドラで index.html を返却し、クライアントサイドルーティングに委ねる。
// 拡張子付きパス (.js / .css / .png 等) は asset とみなし fallback せず 404 を返す
// (存在しない asset を index.html で返すと、ブラウザが script として解釈して破綻するため)。
const WEB_DIST = "./web/dist";
const SPA_INDEX_HTML = `${WEB_DIST}/index.html`;

app.use(
  "/auth/*",
  serveStatic({
    root: WEB_DIST,
    rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
  }),
);

// /account/* も同じ SPA で処理 (plan: アカウント管理画面は /account/ 直下)。
// Layer B の Vite base="/auth/" のため index.html の script src は /auth/assets/... を指すが、
// /account 訪問時もブラウザはそれを取りに行き、上の /auth/* serveStatic で配信されるため整合する。
app.get("/account/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    return c.notFound();
  }
  return new Response(Bun.file(SPA_INDEX_HTML), {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
});

app.get("/auth/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) {
    return c.notFound();
  }
  return new Response(Bun.file(SPA_INDEX_HTML), {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
});

// ヘルスチェック（DB + Redis 疎通確認）
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

// Redis 接続後にサーバー起動
await connectRedis();

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
