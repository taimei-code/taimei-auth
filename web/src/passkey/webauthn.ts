import { PasskeyAlreadyRegistered } from "@core/passkey/errors";
import { type RegistrationOptions, RegistrationResponse } from "@core/passkey/passkey-contract";
import { Data, Effect, Predicate, Schema } from "effect";

export class PasskeyCreationFailed extends Data.TaggedError("PasskeyCreationFailed") {}

class DialogDismissed extends Data.TaggedError("DialogDismissed") {}

type PasskeyCreation = Data.TaggedEnum<{
  Created: { readonly response: RegistrationResponse };
  Cancelled: {};
}>;
export const PasskeyCreation = Data.taggedEnum<PasskeyCreation>();

const decodeRegistrationResponse = Schema.decodeUnknownEffect(RegistrationResponse);

const DIALOG_DISMISSED = "NotAllowedError";
const EXCLUDED_CREDENTIAL_FOUND = "InvalidStateError";

const hasWebAuthnWithJsonApis = (): boolean =>
  "PublicKeyCredential" in globalThis &&
  "parseCreationOptionsFromJSON" in PublicKeyCredential &&
  "parseRequestOptionsFromJSON" in PublicKeyCredential &&
  "toJSON" in PublicKeyCredential.prototype &&
  Predicate.hasProperty(navigator, "credentials") &&
  Predicate.hasProperty(navigator.credentials, "create") &&
  Predicate.hasProperty(navigator.credentials, "get");

export const isPasskeySupported: Effect.Effect<boolean> = Effect.sync(hasWebAuthnWithJsonApis);

const creationFailureOf = (cause: unknown) => {
  const name = Predicate.hasProperty(cause, "name") ? cause.name : undefined;
  if (name === DIALOG_DISMISSED) {
    return new DialogDismissed();
  }
  if (name === EXCLUDED_CREDENTIAL_FOUND) {
    return new PasskeyAlreadyRegistered();
  }
  return new PasskeyCreationFailed();
};

export const createPasskey = Effect.fnUntraced(
  function* (
    options: RegistrationOptions,
  ): Effect.fn.Return<
    PasskeyCreation,
    PasskeyAlreadyRegistered | PasskeyCreationFailed | DialogDismissed
  > {
    if (!(yield* isPasskeySupported)) {
      return yield* new PasskeyCreationFailed();
    }
    const credential = yield* Effect.tryPromise({
      try: (signal) =>
        navigator.credentials.create({
          publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
          signal,
        }),
      catch: creationFailureOf,
    });
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
