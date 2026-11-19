import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { COSEALG, isoBase64URL } from "@simplewebauthn/server/helpers";
import { Effect, Option, Schema } from "effect";
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
import { TtlStore } from "../ttl-store-service";
import { type OwnKeyPrefix, ownKey } from "../ttl-key";
import { PasskeyRepo } from "./ports";

const CHALLENGE_TTL_SECONDS = 5 * 60;

const RESPONSE_TRANSIT_MARGIN_SECONDS = 60;

const CEREMONY_TIMEOUT_MS = (CHALLENGE_TTL_SECONDS - RESPONSE_TRANSIT_MARGIN_SECONDS) * 1000;

const CHALLENGE_BYTES = 32;

const newChallenge = () => crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES));

const CHALLENGE_KEYS = {
  registration: "passkey:registration-challenge",
  authentication: "passkey:sign-in-challenge",
} as const satisfies Record<string, OwnKeyPrefix>;

type Ceremony = keyof typeof CHALLENGE_KEYS;

const challengeKey = (ceremony: Ceremony, challenge: string) =>
  ownKey(CHALLENGE_KEYS[ceremony], challenge);

const entrust = (ceremony: Ceremony, challenge: string, value: string) =>
  TtlStore.use((store) =>
    store.set(challengeKey(ceremony, challenge), value, CHALLENGE_TTL_SECONDS),
  );

const ClientData = Schema.fromJsonString(
  Schema.Struct({ challenge: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/)) }),
);

const challengeIn = (clientDataJSON: string) =>
  Effect.try(() => isoBase64URL.toUTF8String(clientDataJSON)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ClientData)),
    Effect.map(({ challenge }) => challenge),
    Effect.option,
  );

const takeEntrusted = Effect.fnUntraced(function* (ceremony: Ceremony, clientDataJSON: string) {
  const challenge = yield* challengeIn(clientDataJSON);
  if (Option.isNone(challenge)) return undefined;
  const entrusted = yield* TtlStore.use((store) =>
    store.getAndDelete(challengeKey(ceremony, challenge.value)),
  );
  return entrusted === null ? undefined : { challenge: challenge.value, entrusted };
});

const isStorableCredentialId = Schema.is(
  Schema.String.check(
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
    Schema.isMaxLength(PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH),
  ),
);

const rejected = (ceremony: Ceremony, reason: string) =>
  Effect.logWarning(`passkey: ${ceremony} response rejected`, JSON.stringify(reason)).pipe(
    Effect.andThen(Effect.fail(new PasskeyRejected())),
  );

const authHost = () => new URL(getAppUrl());

const isPasskeyTransport = Schema.is(Schema.Literals(PASSKEY_TRANSPORTS));

const knownTransports = (received: ReadonlyArray<unknown> | undefined): PasskeyTransport[] =>
  Array.isArray(received) ? [...new Set<unknown>(received)].filter(isPasskeyTransport) : [];

const SIGNATURE_ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

export const registrationOptions = Effect.fnUntraced(function* (user: {
  readonly userId: string;
  readonly email: string;
}) {
  const registered = yield* PasskeyRepo.use((repo) => repo.listPasskeys(user.userId));
  const options: RegistrationOptions = yield* Effect.promise(() =>
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
      excludeCredentials: registered.map(({ credentialId, transports }) => ({
        id: credentialId,
        transports: [...transports],
      })),
    }),
  );
  yield* entrust("registration", options.challenge, user.userId);
  return options;
});

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
  readonly expectedChallenge: string;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
  readonly requireUserVerification: true;
};

type FixedKeysAbsent = { readonly [Fixed in keyof FixedByEntry]?: never };

const verifiedByLibrary = <Specific, Verified>(
  ceremony: Ceremony,
  challenge: string,
  verify: (options: NoInfer<Specific> & FixedByEntry) => Promise<Verified>,
  specific: Specific & FixedKeysAbsent,
) =>
  Effect.suspend(() => {
    const { origin, hostname } = authHost();
    return Effect.tryPromise({
      try: () =>
        verify({
          ...specific,
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: hostname,
          requireUserVerification: true,
        }),
      catch: (thrown) => (thrown instanceof Error ? thrown.message : String(thrown)),
    });
  }).pipe(Effect.catch((reason) => rejected(ceremony, reason)));

export const verifyRegistration = Effect.fnUntraced(function* (input: {
  readonly userId: string;
  readonly response: RegistrationResponse;
}) {
  const taken = yield* takeEntrusted("registration", input.response.response.clientDataJSON);
  if (taken === undefined || taken.entrusted !== input.userId) {
    return yield* rejected("registration", "challenge not issued to the user");
  }
  const verified = yield* verifiedByLibrary(
    "registration",
    taken.challenge,
    verifyRegistrationResponse,
    { response: toLibraryResponse(input.response), supportedAlgorithmIDs: SIGNATURE_ALGORITHMS },
  );
  if (!verified.verified) return yield* rejected("registration", "not verified");
  const { credential, aaguid } = verified.registrationInfo;
  if (credential.id.length > PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH) {
    return yield* rejected("registration", "credential id too long");
  }
  return {
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: knownTransports(credential.transports),
    aaguid,
  };
});

export const authenticationOptions = Effect.fnUntraced(function* (signIn: {
  readonly redirectUrl: string | undefined;
}) {
  const options: AuthenticationOptions = yield* Effect.promise(() =>
    generateAuthenticationOptions({
      rpID: authHost().hostname,
      challenge: newChallenge(),
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: "required",
    }),
  );
  yield* entrust("authentication", options.challenge, signIn.redirectUrl ?? "");
  return options;
});

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

export const verifyAuthentication = Effect.fnUntraced(function* (input: {
  readonly response: AuthenticationResponse;
}) {
  const taken = yield* takeEntrusted("authentication", input.response.response.clientDataJSON);
  if (taken === undefined) return yield* rejected("authentication", "challenge not issued");
  if (!isStorableCredentialId(input.response.id)) {
    return yield* rejected("authentication", "unregistered credential");
  }
  const saved = yield* PasskeyRepo.use((repo) => repo.findPasskeyByCredentialId(input.response.id));
  if (saved === undefined) return yield* rejected("authentication", "unregistered credential");
  const verified = yield* verifiedByLibrary(
    "authentication",
    taken.challenge,
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
  if (!verified.verified) return yield* rejected("authentication", "not verified");
  const recorded = yield* PasskeyRepo.use((repo) =>
    repo.recordPasskeyUse(saved.id, verified.authenticationInfo.newCounter),
  );
  if (recorded === undefined) return yield* rejected("authentication", "passkey removed");
  return { userId: saved.userId, redirectUrl: taken.entrusted };
});
