import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
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
import type {
  AuthenticationOptions,
  AuthenticationResponse,
  RegistrationOptions,
  RegistrationResponse,
} from "./passkey-contract";
import { PasskeyRepo } from "./ports";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

const RESPONSE_TRANSIT_MARGIN_SECONDS = 60;

const CEREMONY_TIMEOUT_MS = (CHALLENGE_TTL_SECONDS - RESPONSE_TRANSIT_MARGIN_SECONDS) * 1000;

const CHALLENGE_BYTES = 32;

const newChallenge = () => crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));

const ISSUED_CHALLENGE = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((CHALLENGE_BYTES * 4) / 3)}}$`);

export const hasIssuedChallengeShape = (challenge: string): boolean =>
  ISSUED_CHALLENGE.test(challenge);

const authHost = () => new URL(getAppUrl());

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
      challenge: newChallenge(),
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

type FixedByEntry = {
  readonly expectedChallenge: (challenge: unknown) => Promise<boolean>;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly requireUserVerification: true;
};

type FixedKeysAbsent = { readonly [Fixed in keyof FixedByEntry]?: never };

const callLibraryWithChallengeCheck = <Verified, E, R>(
  matchesChallenge: (challenge: string) => Effect.Effect<boolean, E, R>,
  libraryCall: (expectedChallenge: FixedByEntry["expectedChallenge"]) => Promise<Verified>,
): Effect.Effect<Verified, E | RejectedByLibrary, R> =>
  Effect.gen(function* () {
    const runInCaller = Effect.runPromiseExitWith(yield* Effect.context<R>());
    let failedCheck: Cause.Cause<E> | undefined;
    const outcome = yield* Effect.exit(
      Effect.tryPromise({
        try: (signal) =>
          libraryCall(async (challenge) => {
            if (typeof challenge !== "string") return false;
            const exit = await runInCaller(matchesChallenge(challenge), { signal });
            if (Exit.isSuccess(exit)) return exit.value;
            failedCheck = exit.cause;
            return false;
          }),
        catch: (thrown) => new RejectedByLibrary({ thrown }),
      }),
    );
    return yield* failedCheck === undefined ? outcome : Effect.failCause(failedCheck);
  });

const verifiedByLibrary = <Specific, Verified, E, R>(
  ceremony: "registration" | "authentication",
  matchesChallenge: (challenge: string) => Effect.Effect<boolean, E, R>,
  verify: (options: NoInfer<Specific> & FixedByEntry) => Promise<Verified>,
  specific: Specific & FixedKeysAbsent,
) =>
  Effect.suspend(() => {
    const { origin, hostname } = authHost();
    return callLibraryWithChallengeCheck(matchesChallenge, (expectedChallenge) =>
      verify({
        ...specific,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: hostname,
        requireUserVerification: true,
      }),
    );
  }).pipe(
    Effect.catchIf(
      (failure): failure is RejectedByLibrary => failure instanceof RejectedByLibrary,
      ({ thrown }) =>
        Effect.logWarning(
          `passkey: ${ceremony} response rejected`,
          JSON.stringify(thrown instanceof Error ? thrown.message : String(thrown)),
        ).pipe(Effect.andThen(new PasskeyRejected())),
    ),
  );

export const verifyRegistration = <E, R>(input: {
  readonly response: RegistrationResponse;
  readonly matchesChallenge: (challenge: string) => Effect.Effect<boolean, E, R>;
}) =>
  Effect.gen(function* () {
    const verified = yield* verifiedByLibrary(
      "registration",
      input.matchesChallenge,
      verifyRegistrationResponse,
      { response: toLibraryResponse(input.response), supportedAlgorithmIDs: SIGNATURE_ALGORITHMS },
    );
    if (!verified.verified) return yield* new PasskeyRejected();
    const { credential, aaguid } = verified.registrationInfo;
    if (credential.id.length > PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH) {
      return yield* new PasskeyRejected();
    }
    return { ...credential, transports: knownTransports(credential.transports), aaguid };
  });

export const authenticationOptions = (): Effect.Effect<AuthenticationOptions> =>
  Effect.promise(() =>
    generateAuthenticationOptions({
      rpID: authHost().hostname,
      challenge: newChallenge(),
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: "required",
    }),
  );

const toLibraryAuthenticationResponse = (
  response: AuthenticationResponse,
): AuthenticationResponseJSON => ({
  id: response.id,
  rawId: response.rawId,
  type: response.type,
  response: {
    clientDataJSON: response.response.clientDataJSON,
    authenticatorData: response.response.authenticatorData,
    signature: response.response.signature,
    userHandle: response.response.userHandle ?? undefined,
  },
  clientExtensionResults: response.clientExtensionResults,
});

export const verifyAuthentication = <E, R>(input: {
  readonly response: AuthenticationResponse;
  readonly matchesChallenge: (challenge: string) => Effect.Effect<boolean, E, R>;
}) =>
  Effect.gen(function* () {
    const saved = yield* PasskeyRepo.use((repo) =>
      repo.findPasskeyByCredentialId(input.response.id),
    );
    if (saved === undefined) return yield* new PasskeyRejected();
    const verified = yield* verifiedByLibrary(
      "authentication",
      input.matchesChallenge,
      verifyAuthenticationResponse,
      {
        response: toLibraryAuthenticationResponse(input.response),
        credential: {
          id: saved.credentialId,
          publicKey: new Uint8Array(saved.publicKey),
          counter: saved.counter,
          transports: saved.transports,
        },
      },
    );
    if (!verified.verified) return yield* new PasskeyRejected();
    return {
      passkeyId: saved.id,
      userId: saved.userId,
      counter: verified.authenticationInfo.newCounter,
    };
  });
