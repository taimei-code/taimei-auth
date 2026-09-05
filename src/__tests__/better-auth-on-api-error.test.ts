import { describe, expect, test } from "bun:test";
import {
  type AuthContext,
  betterAuth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { auth } from "../auth";
import { DbError } from "../errors";
import { recordSentryExceptions } from "./sentry-recorder";

// better-auth の router は hook / callback の throw を握って 500 Response を返し、`onAPIError.onError` にだけ渡す
// (dist/api/index.mjs の onError)。src/auth.ts の onAPIError はこの機構に乗っているので、その前提を better-auth の
// version に対して固定する。production の auth は runtime を差し替えられないため、memoryAdapter の最小 instance を使う。
const thrown = new Error("boom");

function buildThrowingAuth(phase: "hook" | "onRequest" | "endpoint-5xx" = "hook") {
  const calls: unknown[] = [];
  const throwing: BetterAuthPlugin = {
    id: "throwing",
    hooks: {
      before: [
        {
          matcher: (ctx) => phase === "hook" && ctx.path === "/get-session",
          handler: createAuthMiddleware(async () => {
            throw thrown;
          }),
        },
      ],
    },
    onRequest:
      phase === "onRequest"
        ? async () => {
            throw thrown;
          }
        : undefined,
    endpoints: {
      boom: createAuthEndpoint("/boom", { method: "GET" }, async () => {
        throw new APIError("INTERNAL_SERVER_ERROR", { message: "internal" });
      }),
    },
  };
  const instance = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1234",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [throwing],
    onAPIError: {
      onError: (error) => {
        calls.push(error);
      },
    },
  });
  return { instance, calls };
}

describe("better-auth の router は hook の throw を onAPIError.onError に渡す (機構の固定)", () => {
  test("hook が throw する request は 500 になり onError が同じ Error で 1 回呼ばれる", async () => {
    const { instance, calls } = buildThrowingAuth();
    const res = await instance.handler(new Request("http://localhost:3000/api/auth/get-session"));
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(thrown);
  });

  test("hook が throw しない request では onError は呼ばれず 500 でもない", async () => {
    const { instance, calls } = buildThrowingAuth();
    const res = await instance.handler(new Request("http://localhost:3000/api/auth/ok"));
    expect(res.status).not.toBe(500);
    expect(calls).toHaveLength(0);
  });

  test("auth.api の直呼びは onError を通らず caller に reject する (adapter と二重報告にならない)", async () => {
    const { instance, calls } = buildThrowingAuth();
    await expect(instance.api.getSession({ headers: new Headers() })).rejects.toBe(thrown);
    expect(calls).toHaveLength(0);
  });

  // better-call の router handler は onRequest を processRequest の try/catch の外で await する。rate limiter
  // (secondaryStorage = Redis) の throw はこの経路で、onError に来ず auth.handler の reject になる (src/app.ts が拾う)。
  test("onRequest 段の throw は onError に来ず auth.handler が reject する", async () => {
    const { instance, calls } = buildThrowingAuth("onRequest");
    await expect(
      instance.handler(new Request("http://localhost:3000/api/auth/get-session")),
    ).rejects.toBe(thrown);
    expect(calls).toHaveLength(0);
  });

  // dispatch は endpoint の throw した APIError を Response に変換するので、5xx でも router の catch (onError) に来ない。
  // onError の 5xx 分岐が拾うのは router middleware (originCheck) 由来の APIError だけで、endpoint 内部の 5xx は対象外。
  test("endpoint 内で throw した 5xx APIError は 500 応答になるが onError には来ない", async () => {
    const { instance, calls } = buildThrowingAuth("endpoint-5xx");
    const res = await instance.handler(new Request("http://localhost:3000/api/auth/boom"));
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(0);
  });
});

// src/auth.ts の onAPIError.onError の結線 (設計 AC-015〜020)。ctx (AuthContext) は handler が触らないので空で足りる。
describe("src/auth.ts の onAPIError.onError", () => {
  const captured = recordSentryExceptions();
  const ctx = {} as AuthContext;
  // auth.options は literal 型なので better-auth の option 型に広げて読む (ctx 引数と throw を持つ形)。
  const onAPIError = (auth.options as BetterAuthOptions).onAPIError;
  // 結線の有無は test 内で判定する。describe 本体で throw すると bun は describe ごと落として "0 fail" のまま
  // test 数だけが減る (名前付きの失敗にならない)。
  const onError = (error: unknown): unknown => {
    if (!onAPIError?.onError) throw new Error("src/auth.ts に onAPIError.onError が無い");
    return onAPIError.onError(error, ctx);
  };

  test("onAPIError.onError が結線されている", () => {
    expect(onAPIError?.onError).toBeDefined();
  });

  test("boundary error は cause を warning、component=better-auth で送る", () => {
    const cause = new Error("pg down");
    const n = captured.length;
    onError(new DbError({ cause }));
    expect(captured.length - n).toBe(1);
    expect(captured[n]?.[0]).toBe(cause);
    expect(captured[n]?.[1]?.level).toBe("warning");
    expect(captured[n]?.[1]?.tags?.component).toBe("better-auth");
  });

  test("4xx の APIError は意図した wire failure なので送らない", () => {
    const n = captured.length;
    onError(new APIError("BAD_REQUEST"));
    expect(captured.length - n).toBe(0);
  });

  // router middleware (originCheck) 由来の 5xx APIError の経路。endpoint 内部の 5xx APIError は dispatch が Response に
  // 変換して onError に来ない (上の機構の固定を参照)。
  test("5xx の APIError は better-auth 内部の失敗なので error で送る", () => {
    const n = captured.length;
    onError(new APIError("INTERNAL_SERVER_ERROR"));
    expect(captured.length - n).toBe(1);
    expect(captured[n]?.[1]?.level).toBe("error");
  });

  test("境界は statusCode 500: 500 は送り 499 は送らない", () => {
    const n = captured.length;
    onError(new APIError("INTERNAL_SERVER_ERROR"));
    expect(captured.length - n).toBe(1);
    onError(new APIError("BAD_REQUEST", undefined, undefined, 499));
    expect(captured.length - n).toBe(1);
  });

  test("onError は同期で完結する (戻り値は undefined)", () => {
    expect(onError(new Error("x"))).toBeUndefined();
  });

  test("throw: true は使わない (Hono まで上げると Sentry に届かず Set-Cookie も失う)", () => {
    expect(onAPIError?.throw).toBeFalsy();
  });
});
