import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AuthApi, AuthApiLive } from "../auth-service";

// design §3.8: better-auth API 面の Effect face。失敗は AuthApiError (cause: unknown)。
describe("AuthApiLive", () => {
  test("cookie の無い Headers では session が null", async () => {
    const program = AuthApi.use((authApi) => authApi.getSession(new Headers()));
    expect(await Effect.runPromise(Effect.provide(program, AuthApiLive))).toBeNull();
  });
});
