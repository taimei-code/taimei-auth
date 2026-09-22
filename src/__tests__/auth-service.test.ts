import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AuthApi } from "../auth-service";
import { AuthApiLive } from "../auth-wiring";

describe("AuthApiLive", () => {
  test("cookie の無い Headers では session が null", async () => {
    const program = AuthApi.use((authApi) => authApi.getSession(new Headers()));
    expect(await Effect.runPromise(Effect.provide(program, AuthApiLive))).toBeNull();
  });
});
