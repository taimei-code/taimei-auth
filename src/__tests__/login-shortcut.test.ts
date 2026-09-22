import { beforeEach, describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { Hono } from "hono";
import type { AuthApi } from "../auth-service";
import { SESSION_COOKIE_HEADER } from "../handlers/__tests__/helpers";
import { runProgramInRoute } from "../handlers/__tests__/run-program-in-route";
import { loginShortcut, loginShortcutProgram } from "../handlers/login-shortcut";
import { authFailing, authLayer, sessionOf } from "../membership/__tests__/test-layers";
import { SentryLive } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";

const ORIGIN = "http://auth.taimei-code.com";

// cookie が無い経路は AuthApi に触れないので、live runtime (runRoute) のまま通す。
const app = new Hono().route("/", loginShortcut);

// cookie が有る経路は program を直接走らせ、AuthApi をテスト用の Layer で差し替える (auth-entry-redirect と同じ形)。
const runProgram = (path: string, auth: Layer.Layer<AuthApi>, cookie = true) =>
  runProgramInRoute(
    path,
    `${ORIGIN}${path}`,
    loginShortcutProgram,
    Layer.mergeAll(auth, SentryLive),
    cookie ? { headers: SESSION_COOKIE_HEADER } : undefined,
  );

describe("loginShortcut (未認証)", () => {
  test("GET /login → /auth/ に 302 リダイレクト + 必須クエリ付与", async () => {
    const res = await app.request(`${ORIGIN}/login`);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
    expect(location.searchParams.get("service_name")).toBe("accounts");
    expect(location.searchParams.get("redirect_url")).toBe(`${ORIGIN}/account`);
  });

  test("GET / → /login と同等の 302 + 必須クエリ付与", async () => {
    const res = await app.request(`${ORIGIN}/`);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/");
    expect(location.searchParams.get("service_name")).toBe("accounts");
    expect(location.searchParams.get("redirect_url")).toBe(`${ORIGIN}/account`);
  });

  test("error クエリは passthrough する (/login)", async () => {
    const res = await app.request(`${ORIGIN}/login?error=signin_failed`);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("signin_failed");
  });

  test("error クエリは passthrough する (/)", async () => {
    const res = await app.request(`${ORIGIN}/?error=signin_failed`);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("signin_failed");
  });

  test("未知のクエリは破棄される (allowlist 方式)", async () => {
    const res = await app.request(`${ORIGIN}/login?evil=injection&service_name=overridden`);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("evil")).toBe(null);
    expect(location.searchParams.get("service_name")).toBe("accounts");
  });
});

describe("loginShortcut (認証済み)", () => {
  const signedIn = authLayer(() => sessionOf("u1"));

  test("GET /login で session 有り → /account に 302", async () => {
    const res = await runProgram("/login", signedIn);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/account`);
  });

  test("GET / で session 有り → /account に 302、cache headers 付き", async () => {
    const res = await runProgram("/", signedIn);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/account`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
  });
});

describe("loginShortcut (fail-open)", () => {
  const captured = recordSentryExceptions();
  beforeEach(() => {
    captured.length = 0;
  });

  test("AuthApi が AuthApiError → fail-open で /auth/ に 302、Sentry warning 1 件", async () => {
    const cause = new Error("ttl store down");
    const res = await runProgram("/login", authFailing(cause));

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/auth/");
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(cause);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { handler: "loginShortcut" },
    });
  });

  test("cookie 無しなら AuthApi に触れず /auth/ に 302 (Sentry 0 件)", async () => {
    const res = await runProgram("/login", authFailing(new Error("must not be called")), false);

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/auth/");
    expect(captured.length).toBe(0);
  });
});

describe("loginShortcut (cache headers)", () => {
  test("Cache-Control: private, no-store + Vary: Cookie が付与される", async () => {
    const res = await app.request(`${ORIGIN}/login`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
  });
});
