import { Effect, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

import { messageOnFailure, UndistinguishedFailure } from "../shared/spa-contract-failure";
import type { SpaHttpClient } from "../shared/spa-http-client";
import { getPasskey, isPasskeySupported, PasskeyAssertion } from "./webauthn";

type SpaClient = SpaHttpClient["Service"];

export const PasskeySignIn = defineTaggedUnion({
  SignedIn: { redirectUrl: Schema.String },
  Cancelled: {},
  Failed: {},
});
export type PasskeySignIn = typeof PasskeySignIn.Type;

export const PASSKEY_SIGN_IN_FAILED_MESSAGE =
  "パスキーでログインできませんでした。もう一度試すか、Magic Link か GitHub でログインしてください。";

export const loadPasskeySignInEntry = (client: SpaClient): Effect.Effect<boolean> =>
  Effect.all([client.passkeySignInEntry.availability(), isPasskeySupported]).pipe(
    Effect.map(([{ available }, browserSupported]) => available && browserSupported),
    messageOnFailure({ failure: UndistinguishedFailure, asUnexpected: [], toMessage: () => false }),
  );

export const signInWithPasskey = (
  client: SpaClient,
  redirectUrl: string,
): Effect.Effect<PasskeySignIn> =>
  client.passkeySignIn.options({ payload: { redirect_url: redirectUrl } }).pipe(
    Effect.flatMap(getPasskey),
    Effect.flatMap(
      PasskeyAssertion.$match({
        Asserted: ({ response }) =>
          client.passkeySignIn
            .verify({ payload: response })
            .pipe(
              Effect.map(({ redirect_url }) =>
                PasskeySignIn.SignedIn({ redirectUrl: redirect_url }),
              ),
            ),
        Cancelled: () => Effect.succeed(PasskeySignIn.Cancelled()),
      }),
    ),
    messageOnFailure({
      failure: UndistinguishedFailure,
      asUnexpected: ["PasskeyRejected", "RateLimited", "PasskeyAssertionFailed"],
      toMessage: () => PasskeySignIn.Failed(),
    }),
  );
