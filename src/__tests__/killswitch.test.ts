import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { killswitch } from "../middleware/killswitch";

const buildApp = () => {
  const app = new Hono();
  app.use("/auth/*", killswitch);
  app.use("/api/auth/*", killswitch);
  app.use("/login", killswitch);
  app.get("/auth/", (c) => c.text("layer-b"));
  app.get("/api/auth/session", (c) => c.text("session"));
  app.get("/login", (c) => c.text("login-shortcut"));
  app.get("/rpc/x", (c) => c.text("rpc")); // killswitch 対象外
  return app;
};

describe("killswitch middleware", () => {
  const originalEnv = process.env.COMMON_LOGIN_KILLSWITCH;

  beforeEach(() => {
    delete process.env.COMMON_LOGIN_KILLSWITCH;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COMMON_LOGIN_KILLSWITCH;
    } else {
      process.env.COMMON_LOGIN_KILLSWITCH = originalEnv;
    }
  });

  test("KILLSWITCH=0 の通常時は next() で配信される", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/auth/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("layer-b");
  });

  test("KILLSWITCH=1 で /auth/* は 503 メンテ画面を返す", async () => {
    process.env.COMMON_LOGIN_KILLSWITCH = "1";
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/auth/");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("メンテナンス");
  });

  test("KILLSWITCH=1 で /api/auth/* も 503", async () => {
    process.env.COMMON_LOGIN_KILLSWITCH = "1";
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/api/auth/session");
    expect(res.status).toBe(503);
  });

  test("KILLSWITCH=1 で /login も 503", async () => {
    process.env.COMMON_LOGIN_KILLSWITCH = "1";
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login");
    expect(res.status).toBe(503);
  });

  test("KILLSWITCH=1 でも /rpc/* は対象外で通常動作 (既存セッション維持)", async () => {
    process.env.COMMON_LOGIN_KILLSWITCH = "1";
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/rpc/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("rpc");
  });

  test("disable_common_login=1 クエリは KILLSWITCH=0 でも 503 を返す (監視ツール用強制再現)", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/auth/?disable_common_login=1");
    expect(res.status).toBe(503);
  });
});
