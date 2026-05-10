import { test, expect, describe } from "bun:test";
import { Hono } from "hono";
import { buildLoginShortcut, type IsAuthenticated } from "../handlers/login-shortcut";

const buildApp = (isAuthenticated: IsAuthenticated = async () => false) => {
  const app = new Hono();
  app.route("/", buildLoginShortcut(isAuthenticated));
  return app;
};

describe("loginShortcut (未認証)", () => {
  test("GET /login → /auth/ に 302 リダイレクト + 必須クエリ付与", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
    expect(location.searchParams.get("service_name")).toBe("accounts");
    expect(location.searchParams.get("redirect_url")).toBe("http://auth.taimei-code.com/account");
  });

  test("GET / → /login と同等の 302 + 必須クエリ付与", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
    expect(location.searchParams.get("service_name")).toBe("accounts");
    expect(location.searchParams.get("redirect_url")).toBe("http://auth.taimei-code.com/account");
  });

  test("error クエリは passthrough する (/login)", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login?error=signin_failed");
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("signin_failed");
  });

  test("error クエリは passthrough する (/)", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/?error=signin_failed");
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
    expect(location.searchParams.get("service_name")).toBe("accounts");
  });
});

describe("loginShortcut (認証済み)", () => {
  test("GET /login で session 有り → /account に 302", async () => {
    const app = buildApp(async () => true);
    const res = await app.request("http://auth.taimei-code.com/login");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://auth.taimei-code.com/account");
  });

  test("GET / で session 有り → /account に 302", async () => {
    const app = buildApp(async () => true);
    const res = await app.request("http://auth.taimei-code.com/");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://auth.taimei-code.com/account");
  });
});

describe("loginShortcut (fail-open)", () => {
  test("isAuthenticated が throw → fail-open で /auth/ に 302", async () => {
    const app = buildApp(async () => {
      throw new Error("redis down");
    });
    const res = await app.request("http://auth.taimei-code.com/login");

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
  });
});

describe("loginShortcut (cache headers)", () => {
  test("Cache-Control: private, no-store + Vary: Cookie が付与される", async () => {
    const app = buildApp();
    const res = await app.request("http://auth.taimei-code.com/login");

    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
  });

  test("認証済みでも cache headers が付与される", async () => {
    const app = buildApp(async () => true);
    const res = await app.request("http://auth.taimei-code.com/");

    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
  });
});
