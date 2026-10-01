import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../auth";
import { AuthApi, SessionRejected } from "../auth-service";
import { AuthApiLive } from "../auth-wiring";
import { AuthApiError, isBoundaryError } from "../errors";
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

describe("AuthApiLive.revokeOtherSessions", () => {
  const revoke = AuthApi.use((authApi) => authApi.revokeOtherSessions(new Headers()));

  test("session cookie の無い Headers は better-auth に拒否され SessionRejected になる", async () => {
    const failure = await Effect.runPromise(Effect.provide(Effect.flip(revoke), AuthApiLive));
    expect(failure).toBeInstanceOf(SessionRejected);
  });

  const revokeWithBetterAuthMock = <T>(impl: () => Promise<T>) =>
    withSpy(
      () => spyOn(auth.api, "revokeOtherSessions").mockImplementation(impl as never),
      () => Effect.exit(revoke),
    ).pipe(Effect.provide(AuthApiLive), Effect.runPromise);

  const failureWithBetterAuthMock = async <T>(impl: () => Promise<T>) =>
    Effect.runSync(Effect.flip(await revokeWithBetterAuthMock(impl)));

  test("plain Error の throw は AuthApiError のまま、cause も同じ", async () => {
    const down = new Error("down");
    const failure = await failureWithBetterAuthMock(() => Promise.reject(down));
    expect(failure).toBeInstanceOf(AuthApiError);
    expect((failure as AuthApiError).cause).toBe(down);
  });

  test.each([
    ["code が FORBIDDEN", { body: { code: "FORBIDDEN" } }],
    ["code が 42", { body: { code: 42 } }],
    ["body が無い", { body: undefined }],
    ["null", null],
  ])("%s の throw は AuthApiError のまま", async (_label, thrown) => {
    const failure = await failureWithBetterAuthMock(() => Promise.reject(thrown));
    expect(failure).toBeInstanceOf(AuthApiError);
  });

  test("成功時は返った headers をそのまま返す", async () => {
    const revoked = new Headers({ "set-cookie": "a=1" });
    const headers = Effect.runSync(
      await revokeWithBetterAuthMock(() => Promise.resolve({ headers: revoked })),
    );
    expect(headers.getSetCookie()).toEqual(["a=1"]);
  });

  test("成功して headers が無ければ空の Headers を返す", async () => {
    const headers = Effect.runSync(
      await revokeWithBetterAuthMock(() => Promise.resolve({ headers: undefined })),
    );
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.getSetCookie()).toEqual([]);
  });

  test("SessionRejected は境界の失敗 (500 と Sentry の対象) に含まれない", () => {
    expect(isBoundaryError(new SessionRejected())).toBe(false);
  });
});
