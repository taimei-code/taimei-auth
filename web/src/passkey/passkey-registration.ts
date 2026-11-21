import { Data, Effect } from "effect";

import type { DeclaredFailure, SpaHttpClient } from "../shared/spa-http-client";
import { createPasskey, PasskeyCreation, type PasskeyCreationFailed } from "./webauthn";

type PasskeyApi = SpaHttpClient["Service"]["passkey"];

export type PasskeyFailure = DeclaredFailure<"passkey", keyof PasskeyApi>;

type ApiFailure<Endpoint extends keyof PasskeyApi> = Effect.Error<ReturnType<PasskeyApi[Endpoint]>>;

type PasskeyRegistration = Data.TaggedEnum<{
  Registered: {};
  Cancelled: {};
}>;
export const PasskeyRegistration = Data.taggedEnum<PasskeyRegistration>();

export const registerPasskey = (
  passkeyApi: PasskeyApi,
  totpCode?: string,
): Effect.Effect<
  PasskeyRegistration,
  ApiFailure<"registrationOptions" | "register"> | PasskeyCreationFailed
> =>
  passkeyApi.registrationOptions({ payload: { totp_code: totpCode } }).pipe(
    Effect.flatMap(createPasskey),
    Effect.flatMap(
      PasskeyCreation.$match({
        Created: ({ response }) =>
          passkeyApi
            .register({ payload: response })
            .pipe(Effect.as(PasskeyRegistration.Registered())),
        Cancelled: () => Effect.succeed(PasskeyRegistration.Cancelled()),
      }),
    ),
  );
