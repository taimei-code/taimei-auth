import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { LastOwner } from "./errors";
import { AlreadyOwner } from "./errors";
import { Forbidden, InvalidArgument, NotFound } from "../failures";
import { ROLES } from "../../db/enums";
import { AccountDeleted, CompanyParams, Id, Ok } from "../spa-contract-schemas";

export const RoleSchema = Schema.Literals(ROLES);

const Member = Schema.Struct({
  membership_id: Schema.String,
  user_id: Schema.String,
  user_name: Schema.String,
  user_email: Schema.String,
  role: RoleSchema,
  joined_at: Schema.String,
});

export type Member = typeof Member.Type;

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
