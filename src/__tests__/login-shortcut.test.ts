import { test, expect, describe } from "bun:test";
import { Hono } from "hono";
import { loginShortcut } from "../handlers/login-shortcut";

const buildApp = () => {
  const app = new Hono();
  app.route("/", loginShortcut);
  return app;
};

describe("loginShortcut", () => {
  test("GET /login → /auth/ に 302 リダイレクト + 必須クエリ付与", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
    expect(location.searchParams.get("service_name")).toBe("accounts");
    expect(location.searchParams.get("redirect_url")).toBe("http://auth.taimei-code.com/account");
  });

  test("error クエリは passthrough する", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login?error=signin_failed");
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("signin_failed");
  });

  test("未知のクエリは破棄される (allowlist 方式)", async () => {
    const app = buildApp();
    const res = await app.request(
      "http://auth.taimei-code.com/login?evil=injection&service_name=overridden",
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("evil")).toBe(null);
    // service_name は handler 側で固定されるため override 不可
    expect(location.searchParams.get("service_name")).toBe("accounts");
  });
});
