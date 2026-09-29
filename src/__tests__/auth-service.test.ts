import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../auth";
import { AuthApi } from "../auth-service";
import { AuthApiLive } from "../auth-wiring";
import { AuthApiError } from "../errors";
import { withSpy } from "./live-runner";

describe("AuthApiLive", () => {
  test("cookie の無い Headers では session が null", async () => {
    const program = AuthApi.use((authApi) => authApi.getSession(new Headers()));
    expect(await Effect.runPromise(Effect.provide(program, AuthApiLive))).toBeNull();
  });

  test("better-auth の getSession が同期 throw しても defect にせず AuthApiError で返す", async () => {
    const cause = new Error("sync throw simulating expired session lookup");
    const program = withSpy(
      () =>
        spyOn(auth.api, "getSession").mockImplementation((() => {
          throw cause;
        }) as never),
      () => AuthApi.use((authApi) => authApi.getSession(new Headers())).pipe(Effect.flip),
    );
    const failure = await Effect.runPromise(Effect.provide(program, AuthApiLive));
    expect(failure).toBeInstanceOf(AuthApiError);
    expect(failure.cause).toBe(cause);
  });

  test("signInMagicLink は email と callbackURL を better-auth へそのまま渡す", async () => {
    const input = { email: "invitee@example.com", callbackURL: "http://localhost/auth/accept" };
    const program = withSpy(
      () => spyOn(auth.api, "signInMagicLink").mockResolvedValue({ status: true } as never),
      (spy) =>
        AuthApi.use((authApi) => authApi.signInMagicLink(input)).pipe(
          Effect.map(() => spy.mock.calls.map(([request]) => request)),
        ),
    );
    const requests = await Effect.runPromise(Effect.provide(program, AuthApiLive));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ body: input });
  });
});
