import { Context, type Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { LastOwner } from "./errors";
import { AlreadyOwner, Forbidden, InvalidArgument, NotFound, Unauthorized } from "./guard/errors";
import type { Role } from "./policy";

const RoleSchema = Schema.Literals(["OWNER", "ADMIN", "MEMBER"]);
const _roleSchemaIsExhaustive: [Exclude<Role, typeof RoleSchema.Type>] extends [never]
  ? true
  : never = true;

const Id = Schema.String.check(Schema.isBetweenLength(1, 64));

export const Member = Schema.Struct({
  membership_id: Schema.String,
  user_id: Schema.String,
  user_name: Schema.String,
  user_email: Schema.String,
  role: RoleSchema,
  joined_at: Schema.String,
});
export type Member = typeof Member.Type;

export const PendingInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: RoleSchema,
  expires_at: Schema.String,
  created_at: Schema.String,
});
export type PendingInvitation = typeof PendingInvitation.Type;

const Ok = Schema.Struct({ ok: Schema.Literal(true) });
const company = { companyId: Schema.String };
const target = { companyId: Schema.String, targetUserId: Schema.String };

export type Actor = {
  readonly id: string;
  readonly email: string;
  readonly lastUsedCompanyId: string | null;
};

export class ActorResolver extends Context.Service<
  ActorResolver,
  { readonly resolve: (headers: Headers) => Effect.Effect<Actor, Unauthorized> }
>()("taimei/ActorResolver") {}

export class CurrentActor extends Context.Service<CurrentActor, Actor>()("taimei/CurrentActor") {}

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentActor; requires: ActorResolver }
>()("taimei/Authenticated", { error: Unauthorized }) {}

export class MembersGroup extends HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.get("list", "/api/account/companies/:companyId/members", {
      params: company,
      success: Schema.Struct({ members: Schema.Array(Member) }),
      error: [Unauthorized, Forbidden],
    }),
    HttpApiEndpoint.get("pendingInvitations", "/api/account/companies/:companyId/invitations", {
      params: company,
      success: Schema.Struct({ invitations: Schema.Array(PendingInvitation) }),
      error: [Unauthorized, Forbidden],
    }),
    HttpApiEndpoint.post(
      "changeRole",
      "/api/account/companies/:companyId/members/:targetUserId/role",
      {
        params: target,
        payload: Schema.Struct({ role: RoleSchema }),
        success: Ok,
        error: [Unauthorized, Forbidden, NotFound, InvalidArgument, LastOwner],
      },
    ),
    HttpApiEndpoint.post(
      "remove",
      "/api/account/companies/:companyId/members/:targetUserId/remove",
      {
        params: target,
        success: Schema.Struct({ ok: Schema.Literal(true), account_deleted: Schema.Boolean }),
        error: [Unauthorized, Forbidden, NotFound, LastOwner],
      },
    ),
    HttpApiEndpoint.post(
      "transferOwnership",
      "/api/account/companies/:companyId/transfer-ownership",
      {
        params: company,
        payload: Schema.Struct({ to_user_id: Id }),
        success: Ok,
        error: [Unauthorized, Forbidden, NotFound, InvalidArgument, AlreadyOwner, LastOwner],
      },
    ),
  )
  .middleware(Authenticated) {}

export class AccountApi extends HttpApi.make("account").add(MembersGroup) {}
