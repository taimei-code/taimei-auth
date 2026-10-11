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
export const AccountDeleted = Schema.Struct({ ...Ok.fields, account_deleted: Schema.Boolean });
export const CompanyParams = { companyId: Schema.String };

const Member = Schema.Struct({
  membership_id: Schema.String,
  user_id: Schema.String,
  user_name: Schema.String,
  user_email: Schema.String,
  role: RoleSchema,
  joined_at: Schema.String,
});

const target = { ...CompanyParams, targetUserId: Schema.String };

export class MembershipGroup extends HttpApiGroup.make("membership")
  .add(
    HttpApiEndpoint.get("list", "/api/account/companies/:companyId/members", {
      params: CompanyParams,
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
        success: AccountDeleted,
        error: [Forbidden, NotFound, LastOwner],
      },
    ),
    HttpApiEndpoint.post(
      "transferOwnership",
      "/api/account/companies/:companyId/transfer-ownership",
      {
        params: CompanyParams,
        payload: Schema.Struct({ to_user_id: Id }),
        success: Ok,
        error: [Forbidden, NotFound, InvalidArgument, AlreadyOwner, LastOwner],
      },
    ),
  )
  .middleware(Authenticated) {}
