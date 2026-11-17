import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { RateLimited } from "../failures";
import { Ok } from "../spa-contract-schemas";
import { PasskeyAlreadyRegistered, PasskeyRejected, TotpRequired } from "./errors";

const PasskeyList = Schema.Struct({
  passkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      created_at: Schema.String,
      last_used_at: Schema.NullOr(Schema.String),
    }),
  ),
});

const Transports = Schema.optional(Schema.Array(Schema.String));

const CredentialDescriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  transports: Transports,
});

const RegistrationOptions = Schema.Struct({
  rp: Schema.Struct({ name: Schema.String, id: Schema.optional(Schema.String) }),
  user: Schema.Struct({ id: Schema.String, name: Schema.String, displayName: Schema.String }),
  challenge: Schema.String,
  pubKeyCredParams: Schema.Array(
    Schema.Struct({ alg: Schema.Finite, type: Schema.Literal("public-key") }),
  ),
  timeout: Schema.optional(Schema.Finite),
  excludeCredentials: Schema.optional(Schema.Array(CredentialDescriptor)),
  authenticatorSelection: Schema.optional(
    Schema.Struct({
      authenticatorAttachment: Schema.optional(Schema.String),
      requireResidentKey: Schema.optional(Schema.Boolean),
      residentKey: Schema.optional(Schema.String),
      userVerification: Schema.optional(Schema.String),
    }),
  ),
  attestation: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Struct({ credProps: Schema.optional(Schema.Boolean) })),
  hints: Schema.optional(Schema.Array(Schema.String)),
});
export type RegistrationOptions = typeof RegistrationOptions.Type;

const RegistrationResponse = Schema.Struct({
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

export class PasskeyManagementBudget extends HttpApiMiddleware.Service<PasskeyManagementBudget>()(
  "taimei/PasskeyManagementBudget",
  { error: RateLimited },
) {}

export class PasskeyGroup extends HttpApiGroup.make("passkey")
  .add(
    HttpApiEndpoint.get("list", "/api/account/passkeys", { success: PasskeyList }),
    HttpApiEndpoint.post("registrationOptions", "/api/account/passkeys/registration-options", {
      success: RegistrationOptions,
      error: [TotpRequired],
    }),
    HttpApiEndpoint.post("register", "/api/account/passkeys", {
      payload: RegistrationResponse,
      success: Ok,
      error: [PasskeyRejected, PasskeyAlreadyRegistered],
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
