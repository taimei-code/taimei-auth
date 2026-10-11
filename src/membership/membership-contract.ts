import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { LastOwner } from "./errors";
import { AlreadyOwner, Forbidden, InvalidArgument, NotFound } from "./guard/errors";
import type { Role } from "./policy";

export const RoleSchema = Schema.Literals(["OWNER", "ADMIN", "MEMBER"]);
const _roleSchemaIsExhaustive: [Exclude<Role, typeof RoleSchema.Type>] extends [never]
  ? true
  : never = true;

export const Id = Schema.String.check(Schema.isBetweenLength(1, 64));
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });

const Member = Schema.Struct({
  membership_id: Schema.String,
  user_id: Schema.String,
  user_name: Schema.String,
  user_email: Schema.String,
  role: RoleSchema,
  joined_at: Schema.String,
});
export type Member = typeof Member.Type;

const company = { companyId: Schema.String };
const target = { companyId: Schema.String, targetUserId: Schema.String };

export class MembershipGroup extends HttpApiGroup.make("membership")
  .add(
    HttpApiEndpoint.get("list", "/api/account/companies/:companyId/members", {
      params: company,
      success: Schema.Struct({ members: Schema.Array(Member) }),
      error: Forbidden,
    }),
    HttpApiEndpoint.post(
      "changeRole",
      "/api/account/companies/:companyId/members/:targetUserId/role",
      {
        params: target,
        payload: Schema.Struct({ role: RoleSchema }),
        success: Ok,
        error: [Forbidden, NotFound, LastOwner],
      },
    ),
    HttpApiEndpoint.post(
      "remove",
      "/api/account/companies/:companyId/members/:targetUserId/remove",
      {
        params: target,
        success: Schema.Struct({ ok: Schema.Literal(true), account_deleted: Schema.Boolean }),
        error: [Forbidden, NotFound, LastOwner],
      },
    ),
    HttpApiEndpoint.post(
      "transferOwnership",
      "/api/account/companies/:companyId/transfer-ownership",
      {
        params: company,
        payload: Schema.Struct({ to_user_id: Id }),
        success: Ok,
        error: [Forbidden, NotFound, InvalidArgument, AlreadyOwner, LastOwner],
      },
    ),
  )
  .middleware(Authenticated) {}
