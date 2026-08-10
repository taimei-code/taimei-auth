import { describe, expect, test } from "bun:test";
import type { UnaryRequest, UnaryResponse } from "@connectrpc/connect";
import { createAuthClient, createServiceKeyInterceptor } from "../src/server";

// createServiceKeyInterceptor は taimei-auth IdP の private contract
// (`X-Service-Key`) を SDK 内に閉じる helper。Service Key header の set を機械検証する。

// 最小限の UnaryRequest mock。interceptor 内で参照するのは `header` のみ。
function makeFakeReq(): UnaryRequest {
  return {
    header: new Headers(),
  } as unknown as UnaryRequest;
}

const fakeResponse = {} as UnaryResponse;

describe("createServiceKeyInterceptor", () => {
  test("S1: interceptor 経由のリクエストで X-Service-Key header が set される", async () => {
    const interceptor = createServiceKeyInterceptor("secret123");

    const captured = makeFakeReq();
    const wrapped = interceptor(async (_req) => fakeResponse);
    await wrapped(captured);

    expect(captured.header.get("X-Service-Key")).toBe("secret123");
  });

  test("S1.b: interceptor は next(req) の返り値を素通しする", async () => {
    const interceptor = createServiceKeyInterceptor("secret123");
    const sentinel = {} as UnaryResponse;

    const wrapped = interceptor(async (_req) => sentinel);
    const res = await wrapped(makeFakeReq());

    expect(res).toBe(sentinel);
  });
});

describe("createAuthClient", () => {
  test("S2: transport を直接渡せば authService / userService 両方が生える", () => {
    // 実 RPC を発火しないため transport の中身は何でも良い (型構造のみ満たす dummy)。
    const transport = {
      unary: async () => ({}),
      stream: async () => ({}),
    } as unknown as Parameters<typeof createAuthClient>[0]["transport"];

    const client = createAuthClient({ transport });

    expect(client.authService).toBeDefined();
    expect(client.userService).toBeDefined();
  });
});
