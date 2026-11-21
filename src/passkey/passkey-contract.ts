import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { NotFound, RateLimited } from "../failures";
import { Ok, SignedIn } from "../spa-contract-schemas";
import {
  PasskeyAlreadyRegistered,
  PasskeyLimitReached,
  PasskeyRegistrationUnavailable,
  PasskeyRejected,
  TotpRequired,
} from "./errors";

const PasskeyList = Schema.Struct({
  passkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      created_at: Schema.String,
      last_used_at: Schema.NullOr(Schema.String),
    }),
  ),
  can_register: Schema.Boolean,
});
export type PasskeyListResponse = typeof PasskeyList.Type;

const Transports = Schema.optional(Schema.mutable(Schema.Array(Schema.String)));

const Requirement = Schema.Literals(["discouraged", "preferred", "required"]);

const Hints = Schema.optional(Schema.mutable(Schema.Array(Schema.String)));

const CredentialDescriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  transports: Transports,
});

const RegistrationOptions = Schema.Struct({
  rp: Schema.Struct({ name: Schema.String, id: Schema.optional(Schema.String) }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.String }),
  challenge: Schema.String,
  pubKeyCredParams: Schema.mutable(
    Schema.Array(Schema.Struct({ alg: Schema.Finite, type: Schema.Literal("public-key") })),
  ),
  timeout: Schema.optional(Schema.Finite),
  excludeCredentials: Schema.optional(Schema.mutable(Schema.Array(CredentialDescriptor))),
  authenticatorSelection: Schema.optional(
    Schema.Struct({
      authenticatorAttachment: Schema.optional(Schema.Literals(["platform", "cross-platform"])),
      requireResidentKey: Schema.optional(Schema.Boolean),
      residentKey: Schema.optional(Requirement),
      userVerification: Schema.optional(Requirement),
    }),
  ),
  attestation: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Struct({ credProps: Schema.optional(Schema.Boolean) })),
  hints: Hints,
});
export type RegistrationOptions = typeof RegistrationOptions.Type;

export const RegistrationResponse = Schema.Struct({
  id: Schema.String,
  rawId: Schema.String,
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    attestationObject: Schema.String,
    transports: Transports,
  }),
  clientExtensionResults: Schema.Record(Schema.String, Schema.Unknown),
  authenticatorAttachment: Schema.optional(Schema.NullOr(Schema.String)),
});
export type RegistrationResponse = typeof RegistrationResponse.Type;

const AuthenticationOptions = Schema.Struct({
  challenge: Schema.String,
  timeout: Schema.optional(Schema.Finite),
  rpId: Schema.optional(Schema.String),
  allowCredentials: Schema.optional(Schema.mutable(Schema.Array(CredentialDescriptor))),
  userVerification: Schema.optional(Requirement),
  hints: Hints,
});
export type AuthenticationOptions = typeof AuthenticationOptions.Type;

const AuthenticationResponse = Schema.Struct({
  id: Schema.String,
  rawId: Schema.String,
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Schema.String,
    authenticatorData: Schema.String,
    signature: Schema.String,
    userHandle: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  clientExtensionResults: Schema.Record(Schema.String, Schema.Unknown),
  authenticatorAttachment: Schema.optional(Schema.NullOr(Schema.String)),
});
export type AuthenticationResponse = typeof AuthenticationResponse.Type;

export class PasskeyManagementBudget extends HttpApiMiddleware.Service<PasskeyManagementBudget>()(
  "taimei/PasskeyManagementBudget",
  { error: RateLimited },
) {}

export class PasskeyGroup extends HttpApiGroup.make("passkey")
  .add(
    HttpApiEndpoint.get("list", "/api/account/passkeys", { success: PasskeyList }),
    HttpApiEndpoint.post("registrationOptions", "/api/account/passkeys/registration-options", {
      success: RegistrationOptions,
      error: [TotpRequired, PasskeyRegistrationUnavailable, PasskeyLimitReached],
    }),
    HttpApiEndpoint.post("register", "/api/account/passkeys", {
      payload: RegistrationResponse,
      success: Ok,
      error: [
        PasskeyRejected,
        PasskeyAlreadyRegistered,
        PasskeyRegistrationUnavailable,
        PasskeyLimitReached,
      ],
    }),
    HttpApiEndpoint.post("delete", "/api/account/passkeys/:passkeyId/delete", {
      params: { passkeyId: Schema.String },
      success: Ok,
      error: [NotFound],
    }),
  )
  .middleware(PasskeyManagementBudget)
  .middleware(Authenticated) {}

type PasskeyEndpoint = HttpApiGroup.Endpoints<typeof PasskeyGroup>;

export type PasskeyEndpointsLackingSessionBudget = [PasskeyEndpoint] extends [never]
  ? "パスキーの群に endpoint が無い"
  : PasskeyEndpoint extends infer Endpoint
    ? Endpoint extends unknown
      ? [PasskeyManagementBudget | Authenticated] extends [HttpApiEndpoint.Middleware<Endpoint>]
        ? never
        : Endpoint
      : never
    : never;

const REDIRECT_URL_MAX_LENGTH = 2048;

export class PasskeySignInBudget extends HttpApiMiddleware.Service<PasskeySignInBudget>()(
  "taimei/PasskeySignInBudget",
  { error: RateLimited },
) {}

export class PasskeySignInGroup extends HttpApiGroup.make("passkeySignIn")
  .add(
    HttpApiEndpoint.post("options", "/api/passkey/sign-in/options", {
      payload: Schema.Struct({
        redirect_url: Schema.optional(
          Schema.String.check(Schema.isMaxLength(REDIRECT_URL_MAX_LENGTH)),
        ),
      }),
      success: AuthenticationOptions,
      error: [PasskeyRejected],
    }),
    HttpApiEndpoint.post("verify", "/api/passkey/sign-in/verify", {
      payload: AuthenticationResponse,
      success: SignedIn,
      error: [PasskeyRejected],
    }),
  )
  .middleware(PasskeySignInBudget) {}

type PasskeySignInEndpoint = HttpApiGroup.Endpoints<typeof PasskeySignInGroup>;

export type PasskeySignInEndpointsLackingIpBudget = [PasskeySignInEndpoint] extends [never]
  ? "パスキーのログインの群に endpoint が無い"
  : PasskeySignInEndpoint extends infer Endpoint
    ? Endpoint extends unknown
      ? [PasskeySignInBudget] extends [HttpApiEndpoint.Middleware<Endpoint>]
        ? never
        : Endpoint
      : never
    : never;

export class PasskeySignInEntryGroup extends HttpApiGroup.make("passkeySignInEntry").add(
  HttpApiEndpoint.get("availability", "/api/passkey/sign-in/availability", {
    success: Schema.Struct({ available: Schema.Boolean }),
  }),
) {}
