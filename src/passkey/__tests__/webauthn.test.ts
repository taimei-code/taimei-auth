import { describe, expect, test } from "bun:test";
import { Cause, Context, Data, Deferred, Effect, Exit, Fiber } from "effect";
import { partial } from "../../__tests__/live-runner";
import { DbError } from "../../errors";
import { PasskeyRejected } from "../errors";
import { PasskeyRepo } from "../ports";
import { verifyAuthentication, verifyRegistration } from "../webauthn";

class ChallengeStoreDown extends Data.TaggedError("ChallengeStoreDown") {}

class IssuedChallenge extends Context.Service<IssuedChallenge, { readonly value: string }>()(
  "test/IssuedChallenge",
) {}

const CHALLENGE = "Y2hhbGxlbmdl";

const responseCarrying = (challenge: unknown) => ({
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: {
    clientDataJSON: Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge, origin: "https://unused.example" }),
    ).toString("base64url"),
    attestationObject: "",
  },
});

const RESPONSE = responseCarrying(CHALLENGE);

describe("verifyRegistration の challenge の照合", () => {
  test("照合の関数自身の失敗は、不正な応答の失敗に変えず、そのまま呼び出し側に返す", async () => {
    const failure = await Effect.runPromise(
      verifyRegistration({
        response: RESPONSE,
        matchesChallenge: () => Effect.fail(new ChallengeStoreDown()),
      }).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(ChallengeStoreDown);
  });

  test("照合の関数は、呼び出し側が与えた service を読める", async () => {
    const compared: string[] = [];
    const failure = await Effect.runPromise(
      verifyRegistration({
        response: RESPONSE,
        matchesChallenge: (challenge) =>
          Effect.gen(function* () {
            const issued = yield* IssuedChallenge;
            compared.push(`${challenge}=${issued.value}`);
            return challenge === issued.value;
          }),
      }).pipe(Effect.flip, Effect.provideService(IssuedChallenge, { value: CHALLENGE })),
    );
    expect(compared).toEqual([`${CHALLENGE}=${CHALLENGE}`]);
    expect(failure).toBeInstanceOf(PasskeyRejected);
  });

  test("照合の関数の defect は、不正な応答の失敗に変えず defect のまま返す", async () => {
    const exit = await Effect.runPromiseExit(
      verifyRegistration({ response: RESPONSE, matchesChallenge: () => Effect.die("store bug") }),
    );
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });

  test("clientDataJSON の challenge が文字列でない応答は、照合の関数を呼ばずに不正な応答の失敗になる", async () => {
    for (const challenge of [["Y2hhbGxlbmdl"], 42, null]) {
      const compared: unknown[] = [];
      const failure = await Effect.runPromise(
        verifyRegistration({
          response: responseCarrying(challenge),
          matchesChallenge: (received) => Effect.sync(() => compared.push(received) > 0),
        }).pipe(Effect.flip),
      );
      expect(compared).toEqual([]);
      expect(failure).toBeInstanceOf(PasskeyRejected);
    }
  });

  test("呼び出し側が検証を中断すると、照合の関数も中断される", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        const verifying = yield* verifyRegistration({
          response: RESPONSE,
          matchesChallenge: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        }).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(verifying);
        yield* Deferred.await(interrupted).pipe(Effect.timeout("1 second"));
      }),
    );
  });
});

describe("verifyAuthentication の行の引き当て", () => {
  test("行の引き当てが DB で失敗すると、不正な応答の失敗に変えず、その失敗のまま返す", async () => {
    const failure = await Effect.runPromise(
      verifyAuthentication({
        response: {
          id: "Y3JlZGVudGlhbA",
          rawId: "Y3JlZGVudGlhbA",
          type: "public-key",
          clientExtensionResults: {},
          response: { clientDataJSON: "", authenticatorData: "", signature: "" },
        },
        matchesChallenge: () => Effect.succeed(true),
      }).pipe(
        Effect.flip,
        Effect.provideService(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            findPasskeyByCredentialId: () => Effect.fail(new DbError({ cause: "db down" })),
          }),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DbError);
  });
});
