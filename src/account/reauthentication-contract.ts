import type { ReauthenticationOperation } from "../../db/enums";
import { Context } from "effect";
import type { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { HttpApiMiddleware } from "effect/http-api";
import { ReauthenticationRequired } from "../failures";
import type { CurrentActor, CurrentSession } from "./actor-contract";

export class WithinSessionAttemptBudget extends Context.Service<WithinSessionAttemptBudget, true>()(
  "taimei/WithinSessionAttemptBudget",
) {}

export class Reauthenticated extends HttpApiMiddleware.Service<
  Reauthenticated,
  { requires: CurrentActor | CurrentSession | WithinSessionAttemptBudget }
>()("taimei/Reauthenticated", { error: ReauthenticationRequired }) {}

export const REAUTHENTICATED_OPERATIONS = {
  "mfa.enroll": "mfa_enroll",
  "mfa.activate": "mfa_activate",
  "passkey.registrationOptions": "passkey_register",
  "passkey.register": "passkey_register",
} as const satisfies Record<string, ReauthenticationOperation>;

type EndpointKey<Group, Endpoint> =
  `${HttpApiGroup.Identifier<Group>}.${HttpApiEndpoint.Identifier<Endpoint>}`;

type IsReauthenticated<Endpoint> = [Reauthenticated] extends [HttpApiEndpoint.Middleware<Endpoint>]
  ? true
  : false;

type BreakingInGroup<Group> =
  HttpApiGroup.Endpoints<Group> extends infer Endpoint
    ? Endpoint extends unknown
      ? (
          EndpointKey<Group, Endpoint> extends keyof typeof REAUTHENTICATED_OPERATIONS
            ? true
            : false
        ) extends IsReauthenticated<Endpoint>
        ? never
        : EndpointKey<Group, Endpoint>
      : never
    : never;

type EndpointKeysOf<Group> =
  HttpApiGroup.Endpoints<Group> extends infer Endpoint
    ? Endpoint extends unknown
      ? EndpointKey<Group, Endpoint>
      : never
    : never;

export type EndpointsBreakingReauthentication<Groups> =
  | (Groups extends unknown ? BreakingInGroup<Groups> : never)
  | Exclude<
      keyof typeof REAUTHENTICATED_OPERATIONS,
      Groups extends unknown ? EndpointKeysOf<Groups> : never
    >;
