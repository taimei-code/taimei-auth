import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { deleteOwnedPasskey } from "../passkey/delete-passkey";
import { listOwnedPasskeys } from "../passkey/list-passkeys";
import { issueRegistrationOptions, registerPasskey } from "../passkey/register-passkey";
import { passkeySignInAvailability, signInWithPasskey } from "../passkey/sign-in-with-passkey";
import { authenticationOptions } from "../passkey/webauthn";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary, forwardSetCookies, headersOf } from "./request-http-api";

export const PasskeyHandlers = HttpApiBuilder.group(SpaApi, "passkey", (handlers) =>
  handlers.handleAll({
    list: Effect.fnUntraced(function* () {
      const owned = yield* listOwnedPasskeys(yield* CurrentActor);
      return {
        passkeys: owned.passkeys.map((passkey) => ({
          id: passkey.id,
          created_at: DateTime.fromDateUnsafe(passkey.createdAt),
          last_used_at:
            passkey.lastUsedAt === null ? null : DateTime.fromDateUnsafe(passkey.lastUsedAt),
          provider_name: passkey.providerName,
        })),
        can_register: owned.canRegister,
      };
    }, dieOnBoundary),
    registrationOptions: Effect.fnUntraced(function* ({ payload }) {
      return yield* issueRegistrationOptions(yield* CurrentActor, payload.totp_code);
    }, dieOnBoundary),
    register: Effect.fnUntraced(function* ({ payload }) {
      yield* registerPasskey(yield* CurrentActor, payload);
      return { ok: true as const };
    }, dieOnBoundary),
    delete: Effect.fnUntraced(function* ({ params }) {
      yield* deleteOwnedPasskey(yield* CurrentActor, params.passkeyId);
      return { ok: true as const };
    }, dieOnBoundary),
  }),
);

export const PasskeySignInHandlers = HttpApiBuilder.group(SpaApi, "passkeySignIn", (handlers) =>
  handlers.handleAll({
    options: ({ payload }) =>
      authenticationOptions({ redirectUrl: payload.redirect_url }).pipe(dieOnBoundary),
    verify: Effect.fnUntraced(function* ({ payload, request }) {
      const signedIn = yield* signInWithPasskey(headersOf(request), payload);
      yield* forwardSetCookies(signedIn.forwardedHeaders);
      return { redirect_url: signedIn.redirectUrl };
    }, dieOnBoundary),
  }),
);

export const PasskeySignInEntryHandlers = HttpApiBuilder.group(
  SpaApi,
  "passkeySignInEntry",
  (handlers) =>
    handlers.handle("availability", () => passkeySignInAvailability().pipe(dieOnBoundary)),
);
