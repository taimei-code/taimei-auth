import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { COSEALG } from "@simplewebauthn/server/helpers";
import { type Cause, Effect, Exit } from "effect";
import { getAppName, getAppUrl } from "../email/client";
import { PasskeyRejected } from "./errors";

export type RegistrationOptions = PublicKeyCredentialCreationOptionsJSON;

export type RegistrationResponse = RegistrationResponseJSON;

const authHost = () => new URL(getAppUrl());

class ChallengeCheckFailed<E> extends Error {
  constructor(readonly failed: Cause.Cause<E>) {
    super("challenge check failed inside the verification library");
    this.name = "ChallengeCheckFailed";
  }
}

const SIGNATURE_ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

export const registrationOptions = (user: {
  readonly userId: string;
  readonly email: string;
}): Effect.Effect<RegistrationOptions> =>
  Effect.promise(() =>
    generateRegistrationOptions({
      rpName: getAppName(),
      rpID: authHost().hostname,
      userID: new TextEncoder().encode(user.userId),
      userName: user.email,
      userDisplayName: user.email,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: SIGNATURE_ALGORITHMS,
    }),
  );

export const verifyRegistration = <E, R>(input: {
  readonly response: RegistrationResponse;
  readonly matchesChallenge: (challenge: string) => Effect.Effect<boolean, E, R>;
}) =>
  Effect.gen(function* () {
    const runInCaller = Effect.runPromiseExitWith(yield* Effect.context<R>());
    const { origin, hostname } = authHost();
    const verified = yield* Effect.tryPromise({
      try: (signal) =>
        verifyRegistrationResponse({
          response: input.response,
          expectedChallenge: async (challenge: unknown) => {
            if (typeof challenge !== "string") return false;
            const exit = await runInCaller(input.matchesChallenge(challenge), { signal });
            if (Exit.isFailure(exit)) throw new ChallengeCheckFailed(exit.cause);
            return exit.value;
          },
          expectedOrigin: origin,
          expectedRPID: hostname,
          requireUserVerification: true,
          supportedAlgorithmIDs: SIGNATURE_ALGORITHMS,
        }),
      catch: (thrown) =>
        thrown instanceof ChallengeCheckFailed
          ? (thrown as ChallengeCheckFailed<E>)
          : new PasskeyRejected(),
    }).pipe(
      Effect.catchIf(
        (failure): failure is ChallengeCheckFailed<E> => failure instanceof ChallengeCheckFailed,
        (failure) => Effect.failCause(failure.failed),
      ),
    );
    if (!verified.verified) return yield* new PasskeyRejected();
    const { credential, aaguid } = verified.registrationInfo;
    return { ...credential, aaguid };
  });
