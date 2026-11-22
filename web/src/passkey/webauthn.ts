import { PasskeyAlreadyRegistered, PasskeyRejected } from "@core/passkey/errors";
import {
  AuthenticationResponse,
  type AuthenticationOptions,
  type RegistrationOptions,
  RegistrationResponse,
} from "@core/passkey/passkey-contract";
import { Clock, Data, Effect, Predicate, Schema } from "effect";

export class PasskeyCreationFailed extends Data.TaggedError("PasskeyCreationFailed") {}

class PasskeyAssertionFailed extends Data.TaggedError("PasskeyAssertionFailed") {}

class DialogDismissed extends Data.TaggedError("DialogDismissed") {}

type PasskeyCreation = Data.TaggedEnum<{
  Created: { readonly response: RegistrationResponse };
  Cancelled: {};
}>;
export const PasskeyCreation = Data.taggedEnum<PasskeyCreation>();

type PasskeyAssertion = Data.TaggedEnum<{
  Asserted: { readonly response: AuthenticationResponse };
  Cancelled: {};
}>;
export const PasskeyAssertion = Data.taggedEnum<PasskeyAssertion>();

const decodeRegistrationResponse = Schema.decodeUnknownEffect(RegistrationResponse);

const decodeAuthenticationResponse = Schema.decodeUnknownEffect(AuthenticationResponse);

const DIALOG_DISMISSED = "NotAllowedError";
const EXCLUDED_CREDENTIAL_FOUND = "InvalidStateError";
const CEREMONY_TIMER_SLACK_MS = 1000;
const NANOS_PER_MILLI = 1_000_000n;

const ceremonyExpired = (
  options: { readonly timeout?: number },
  startedAt: bigint,
  endedAt: bigint,
) =>
  options.timeout !== undefined &&
  Number((endedAt - startedAt) / NANOS_PER_MILLI) >= options.timeout - CEREMONY_TIMER_SLACK_MS;

const hasWebAuthnWithJsonApis = (): boolean =>
  "PublicKeyCredential" in globalThis &&
  "parseCreationOptionsFromJSON" in PublicKeyCredential &&
  "parseRequestOptionsFromJSON" in PublicKeyCredential &&
  "toJSON" in PublicKeyCredential.prototype &&
  Predicate.hasProperty(navigator, "credentials") &&
  Predicate.hasProperty(navigator.credentials, "create") &&
  Predicate.hasProperty(navigator.credentials, "get");

export const isPasskeySupported: Effect.Effect<boolean> = Effect.sync(hasWebAuthnWithJsonApis);

const nameOf = (cause: unknown) => (Predicate.hasProperty(cause, "name") ? cause.name : undefined);

const creationFailureOf = (cause: unknown) => {
  const name = nameOf(cause);
  if (name === DIALOG_DISMISSED) {
    return new DialogDismissed();
  }
  if (name === EXCLUDED_CREDENTIAL_FOUND) {
    return new PasskeyAlreadyRegistered();
  }
  return new PasskeyCreationFailed();
};

const assertionFailureOf = (cause: unknown) =>
  nameOf(cause) === DIALOG_DISMISSED ? new DialogDismissed() : new PasskeyAssertionFailed();

const dismissedWithin =
  <Expired>(options: { readonly timeout?: number }, startedAt: bigint, expired: () => Expired) =>
  (dismissed: DialogDismissed) =>
    Effect.flatMap(
      Clock.monotonicTimeNanos,
      (endedAt): Effect.Effect<never, DialogDismissed | Expired> =>
        ceremonyExpired(options, startedAt, endedAt)
          ? Effect.fail(expired())
          : Effect.fail(dismissed),
    );

export const createPasskey = Effect.fnUntraced(
  function* (
    options: RegistrationOptions,
  ): Effect.fn.Return<
    PasskeyCreation,
    PasskeyAlreadyRegistered | PasskeyCreationFailed | PasskeyRejected | DialogDismissed
  > {
    if (!(yield* isPasskeySupported)) {
      return yield* new PasskeyCreationFailed();
    }
    const startedAt = yield* Clock.monotonicTimeNanos;
    const credential = yield* Effect.tryPromise({
      try: (signal) =>
        navigator.credentials.create({
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
          signal,
        }),
      catch: creationFailureOf,
    }).pipe(
      Effect.catchTag(
        "DialogDismissed",
        dismissedWithin(options, startedAt, () => new PasskeyRejected()),
      ),
    );
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyCreationFailed();
    }
    const json = yield* Effect.try({
      try: () => credential.toJSON(),
      catch: () => new PasskeyCreationFailed(),
    });
    const response = yield* decodeRegistrationResponse(json).pipe(
      Effect.mapError(() => new PasskeyCreationFailed()),
    );
    return PasskeyCreation.Created({ response });
  },
  Effect.catchTag("DialogDismissed", () => Effect.succeed(PasskeyCreation.Cancelled())),
);

export const getPasskey = Effect.fnUntraced(
  function* (
    options: AuthenticationOptions,
  ): Effect.fn.Return<PasskeyAssertion, PasskeyAssertionFailed | DialogDismissed> {
    if (!(yield* isPasskeySupported)) {
      return yield* new PasskeyAssertionFailed();
    }
    const startedAt = yield* Clock.monotonicTimeNanos;
    const credential = yield* Effect.tryPromise({
      try: (signal) =>
        navigator.credentials.get({
          publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
          signal,
        }),
      catch: assertionFailureOf,
    }).pipe(
      Effect.catchTag(
        "DialogDismissed",
        dismissedWithin(options, startedAt, () => new PasskeyAssertionFailed()),
      ),
    );
    if (!(credential instanceof PublicKeyCredential)) {
      return yield* new PasskeyAssertionFailed();
    }
    const json = yield* Effect.try({
      try: () => credential.toJSON(),
      catch: () => new PasskeyAssertionFailed(),
    });
    const response = yield* decodeAuthenticationResponse(json).pipe(
      Effect.mapError(() => new PasskeyAssertionFailed()),
    );
    return PasskeyAssertion.Asserted({ response });
  },
  Effect.catchTag("DialogDismissed", () => Effect.succeed(PasskeyAssertion.Cancelled())),
);
