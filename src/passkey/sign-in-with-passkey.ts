import { Effect } from "effect";
import { establishSignIn } from "../establish-sign-in";
import { passkeyReleased } from "./availability";
import type { AuthenticationResponse } from "./passkey-contract";
import { verifyAuthentication } from "./webauthn";

export const signInWithPasskey = Effect.fnUntraced(function* (
  headers: Headers,
  response: AuthenticationResponse,
) {
  const verified = yield* verifyAuthentication({ response });
  return yield* establishSignIn(headers, {
    userId: verified.userId,
    method: "passkey",
    redirectUrl: verified.redirectUrl,
  });
});

export const passkeySignInAvailability = () =>
  passkeyReleased().pipe(Effect.map((available) => ({ available })));
