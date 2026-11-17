import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { RateLimited } from "../failures";

const PasskeyList = Schema.Struct({
  passkeys: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      created_at: Schema.String,
      last_used_at: Schema.NullOr(Schema.String),
    }),
  ),
});

export class PasskeyManagementBudget extends HttpApiMiddleware.Service<PasskeyManagementBudget>()(
  "taimei/PasskeyManagementBudget",
  { error: RateLimited },
) {}

export class PasskeyGroup extends HttpApiGroup.make("passkey")
  .add(HttpApiEndpoint.get("list", "/api/account/passkeys", { success: PasskeyList }))
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
