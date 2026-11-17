import {
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { COSEALG } from "@simplewebauthn/server/helpers";
import { type Cause, Data, Effect, Exit, Schema } from "effect";
import {
  PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH,
  PASSKEY_TRANSPORTS,
  type PasskeyTransport,
} from "@/db/enums";
import { getAppName, getAppUrl } from "../email/client";
import { PasskeyRejected } from "./errors";
import type { RegistrationOptions, RegistrationResponse } from "./passkey-contract";

export const REGISTRATION_CHALLENGE_TTL_SECONDS = 5 * 60;

const RESPONSE_TRANSIT_MARGIN_SECONDS = 60;

const CEREMONY_TIMEOUT_MS =
  (REGISTRATION_CHALLENGE_TTL_SECONDS - RESPONSE_TRANSIT_MARGIN_SECONDS) * 1000;

const CHALLENGE_BYTES = 32;

const ISSUED_CHALLENGE = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((CHALLENGE_BYTES * 4) / 3)}}$`);

export const hasIssuedChallengeShape = (challenge: string): boolean =>
  ISSUED_CHALLENGE.test(challenge);

const authHost = () => new URL(getAppUrl());

class ChallengeCheckFailed<E> extends Error {
  constructor(readonly failed: Cause.Cause<E>) {
    super("challenge check failed inside the verification library");
    this.name = "ChallengeCheckFailed";
  }
}

class RejectedByLibrary extends Data.TaggedError("RejectedByLibrary")<{
  readonly thrown: unknown;
}> {}

const isPasskeyTransport = Schema.is(Schema.Literals(PASSKEY_TRANSPORTS));

const knownTransports = (received: ReadonlyArray<unknown> | undefined): PasskeyTransport[] =>
  Array.isArray(received) ? [...new Set<unknown>(received)].filter(isPasskeyTransport) : [];

const SIGNATURE_ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

export const registrationOptions = (user: {
  readonly userId: string;
  readonly email: string;
  readonly excludeCredentials?: ReadonlyArray<{
    readonly credentialId: string;
    readonly transports: ReadonlyArray<PasskeyTransport>;
  }>;
}): Effect.Effect<RegistrationOptions> =>
  Effect.promise(() =>
    generateRegistrationOptions({
      rpName: getAppName(),
      rpID: authHost().hostname,
      userID: new TextEncoder().encode(user.userId),
      userName: user.email,
      userDisplayName: user.email,
      challenge: crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES)),
      timeout: CEREMONY_TIMEOUT_MS,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      supportedAlgorithmIDs: SIGNATURE_ALGORITHMS,
      excludeCredentials: (user.excludeCredentials ?? []).map(({ credentialId, transports }) => ({
        id: credentialId,
        transports: [...transports],
      })),
    }),
  );

const toLibraryResponse = (response: RegistrationResponse): RegistrationResponseJSON => ({
  id: response.id,
  rawId: response.rawId,
  type: response.type,
  response: {
    clientDataJSON: response.response.clientDataJSON,
    attestationObject: response.response.attestationObject,
    transports: knownTransports(response.response.transports),
  },
  clientExtensionResults: response.clientExtensionResults,
});

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
          response: toLibraryResponse(input.response),
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
          : new RejectedByLibrary({ thrown }),
    }).pipe(
      Effect.catchIf(
        (failure): failure is ChallengeCheckFailed<E> => failure instanceof ChallengeCheckFailed,
        (failure) => Effect.failCause(failure.failed),
      ),
      Effect.catchIf(
        (failure): failure is RejectedByLibrary => failure instanceof RejectedByLibrary,
        ({ thrown }) =>
          Effect.logWarning(
            "passkey: registration response rejected",
            JSON.stringify(thrown instanceof Error ? thrown.message : String(thrown)),
          ).pipe(Effect.andThen(new PasskeyRejected())),
      ),
    );
    if (!verified.verified) return yield* new PasskeyRejected();
    const { credential, aaguid } = verified.registrationInfo;
    if (credential.id.length > PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH) {
      return yield* new PasskeyRejected();
    }
    return { ...credential, transports: knownTransports(credential.transports), aaguid };
  });
