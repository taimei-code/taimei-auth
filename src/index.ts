import * as http from "node:http";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { auth } from "./auth";
import { connectRedis, redis } from "./redis";
import { registerRoutes } from "./rpc/routes";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

const app = new Hono();

// CORS middleware
const allowedOrigins = (process.env.AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Service-Key", "Connect-Protocol-Version"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
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
app.all("/rpc/*", async (c) => {
  const url = new URL(c.req.url);
  const proxyUrl = `http://127.0.0.1:${rpcPort}${url.pathname}`;

  const proxyRes = await fetch(proxyUrl, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" ? c.req.raw.body : undefined,
    // @ts-expect-error Bun supports duplex
    duplex: "half",
  });

  return new Response(proxyRes.body, {
    status: proxyRes.status,
    headers: proxyRes.headers,
  });
});

// Better Auth HTTP ハンドラー
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
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
