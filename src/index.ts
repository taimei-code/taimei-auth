import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";

const app = new Hono();

// CORS middleware（trustedOrigins は CSRF 保護のみ。ブラウザの CORS には別途必要）
const allowedOrigins = (process.env.AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Service-Key"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// サービス間認証 middleware（/api/auth/** はブラウザからも呼ばれるため除外）
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

// Better Auth HTTP ハンドラー
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(process.env.PORT) || 3100;
console.log(`auth-service listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
