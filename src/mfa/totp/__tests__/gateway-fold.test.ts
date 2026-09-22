import { describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";
import { expectFailure, withSpy } from "../../../__tests__/live-runner";
import { recordSentryExceptions } from "../../../__tests__/sentry-recorder";
import { auth } from "../../../auth";
import { AuthApiError } from "../../../errors";
import { SentryLive } from "../../../sentry";
import { ChallengeExpired } from "../../error-mapping";
import { MfaSessions } from "../ports";
import { MfaLayers } from "../wiring";

// better-auth の revokeOtherSessions の失敗を「body.code 付き → ChallengeExpired (観測あり)、それ以外 →
// AuthApiError (素通り)」に畳む境界。gateway は import せず wiring の live 結線を通して観測する (containment AC-150a)。

const captured = recordSentryExceptions();
const headers = new Headers();

const revokeWith = <T>(impl: () => Promise<T>) =>
  withSpy(
    () => spyOn(auth.api, "revokeOtherSessions").mockImplementation(impl as never),
    () =>
      Effect.provide(
        Effect.exit(MfaSessions.use((s) => s.revokeOthers(headers))),
        Layer.mergeAll(MfaLayers, SentryLive),
      ),
  ).pipe(Effect.runPromise);

const failureOf = (exit: Awaited<ReturnType<typeof revokeWith>>) =>
  Effect.runSync(Effect.flip(exit));

describe("MfaSessions.revokeOthers (gateway の fold)", () => {
  test("body.code 付きの throw → ChallengeExpired、Sentry warning に mfa-gateway で 1 件", async () => {
    captured.length = 0;
    const apiError = { body: { code: "SESSION_EXPIRED" } };
    const e = failureOf(await revokeWith(() => Promise.reject(apiError)));

    expectFailure(e, ChallengeExpired, "challenge_expired", 401);
    expect(captured.length).toBe(1);
    expect(captured[0]?.[0]).toBe(apiError);
    expect(captured[0]?.[1]).toMatchObject({
      level: "warning",
      tags: { component: "mfa-gateway" },
    });
  });

  test("plain Error の throw → AuthApiError のまま (Sentry 0 件)", async () => {
    captured.length = 0;
    const down = new Error("down");
    const e = failureOf(await revokeWith(() => Promise.reject(down)));

    expect(e).toBeInstanceOf(AuthApiError);
    expect((e as AuthApiError).cause).toBe(down);
    expect(captured.length).toBe(0);
  });

  test("body.code が string でない throw → AuthApiError (述語の境界)", async () => {
    const e = failureOf(await revokeWith(() => Promise.reject({ body: { code: 42 } })));
    expect(e).toBeInstanceOf(AuthApiError);
  });

  test("成功時は返った headers をそのまま、headers 無しなら空の Headers", async () => {
    const revoked = new Headers({ "set-cookie": "a=1" });
    const withHeaders = Effect.runSync(
      await revokeWith(() => Promise.resolve({ headers: revoked })),
    );
    expect(withHeaders.getSetCookie()).toEqual(["a=1"]);

    const without = Effect.runSync(await revokeWith(() => Promise.resolve({ headers: undefined })));
    expect(without).toBeInstanceOf(Headers);
    expect(without.getSetCookie()).toEqual([]);
  });
});
