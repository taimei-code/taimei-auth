import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { BETTER_AUTH_METHODS, buildApp } from "../app";
import { auth } from "../auth";
import { dbTest } from "./live-runner";
import { recordSentry } from "./sentry-recorder";
import { createSessionFor } from "./session-helpers";
import { TestDb } from "./test-db";

describe("/api/auth/* の mount は auth.handler の reject を Sentry に送る", () => {
  const { exceptions: captured } = recordSentry();
  const app = buildApp({ mountStatic: () => {} });

  test("reject は component=better-auth で error として送り、Hono 既定と同じ 500 text を返す", async () => {
    const rejection = new Error("upstash down");
    const handler = spyOn(auth, "handler").mockRejectedValue(rejection);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/get-session");
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Internal Server Error");
      expect(captured.length - n).toBe(1);
      expect(captured[n]?.[0]).toBe(rejection);
      expect(captured[n]?.[1]).toEqual({ level: "error", tags: { component: "better-auth" } });
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      handler.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("POST も同じ経路で拾い、body を再構築した Request を渡す", async () => {
    const handler = spyOn(auth, "handler").mockRejectedValue(new Error("upstash down"));
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.com" }),
      });
      expect(res.status).toBe(500);
      expect(captured.length - n).toBe(1);
      const passed = handler.mock.calls[0]?.[0] as Request;
      expect(passed.method).toBe("POST");
      expect(await passed.text()).toBe(JSON.stringify({ email: "a@example.com" }));
    } finally {
      handler.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("resolve した Response はそのまま返し、Sentry には送らない", async () => {
    const handler = spyOn(auth, "handler").mockResolvedValue(new Response("ok", { status: 200 }));
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/ok");
      expect(res.status).toBe(200);
      expect(captured.length - n).toBe(0);
    } finally {
      handler.mockRestore();
    }
  });
});

test("better-auth の endpoint が使う method はすべて /api/auth/* に mount している (漏れると static fallback が 200 の HTML を返して気付けない)", () => {
  const endpointMethods = Object.values(
    auth.api as unknown as Record<string, { options?: { method?: string | string[] } }>,
  ).flatMap((endpoint) => endpoint?.options?.method ?? []);
  const mounted: readonly string[] = BETTER_AUTH_METHODS;
  expect(endpointMethods.length).toBeGreaterThan(0);
  expect([...new Set(endpointMethods)].filter((method) => !mounted.includes(method))).toEqual([]);
});

describe("GitHub の連携を後から足す経路 (link-social) は、better-auth に渡す前に塞ぐ", () => {
  const app = buildApp({ mountStatic: () => {} });
  const postGitHubProvider = async (path: string, sessionHeaders: Headers = new Headers()) => {
    const headers = new Headers(sessionHeaders);
    headers.set("content-type", "application/json");
    headers.set("origin", "http://localhost:3000");
    return app.request(`http://localhost:3000${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "github" }),
    });
  };
  describe("ログイン済みの user", () => {
    const { run, cleanup } = dbTest("closed-link-social-");
    beforeEach(cleanup);
    afterAll(cleanup);

    test("ログイン済みの user の session の cookie を付けた要求も、better-auth に届かずに 404 で失敗し、連携の行は増えない (連携の追加を画面に足すときは、塞ぎを外し、ADR-0031 の直近のログインの時間窓を条件にする)", () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const user = yield* db.seedUser("u1");
          const { headers } = yield* createSessionFor(user.id);
          const before = yield* db.countAccounts(user.id);
          const handler = spyOn(auth, "handler");

          const { status, handlerCalls } = yield* Effect.promise(() =>
            postGitHubProvider("/api/auth/link-social", headers),
          ).pipe(
            Effect.map((response) => ({
              status: response.status,
              handlerCalls: handler.mock.calls.length,
            })),
            Effect.ensuring(Effect.sync(() => handler.mockRestore())),
          );

          expect(status).toBe(404);
          expect(handlerCalls).toBe(0);
          expect(yield* db.countAccounts(user.id)).toBe(before);
        }),
      ));
  });

  test("表記を変えた path (末尾の /、大文字、//、percent-encoding、query string 付き) も link-social に届かずに 404 になる (better-auth の router は path を完全一致で引き、届けば cookie 無しの要求は 401 になる)", async () => {
    const paths = [
      "/api/auth/link-social",
      "/api/auth/link-social/",
      "/api/auth/Link-Social",
      "/api/auth//link-social",
      "/api/auth/link%2Dsocial",
      "/api/auth/%6Cink-social",
      "/api/auth/link-social?provider=github",
    ];

    const statuses = await Promise.all(
      paths.map(async (path) => [path, (await postGitHubProvider(path)).status]),
    );

    expect(statuses).toEqual(paths.map((path) => [path, 404]));
  });

  test("GitHub でのログインの入口 (sign-in/social と callback/github) は今まで通り better-auth に届く", async () => {
    const handler = spyOn(auth, "handler").mockResolvedValue(new Response(null, { status: 302 }));
    try {
      await postGitHubProvider("/api/auth/sign-in/social");
      await app.request("http://localhost:3000/api/auth/callback/github?code=c&state=s");

      expect(handler.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
        "/api/auth/sign-in/social",
        "/api/auth/callback/github",
      ]);
    } finally {
      handler.mockRestore();
    }
  });
});
