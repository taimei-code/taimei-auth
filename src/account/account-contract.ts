import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { LastOwner } from "../membership/errors";
import { Forbidden, NotFound } from "../failures";
import { OrgCodeSchema } from "../company/company-contract";
import { RoleSchema } from "../membership/membership-contract";
import { Id, Ok } from "../spa-contract-schemas";
import { Authenticated } from "./actor-contract";

const CompanyState = Schema.Struct({
  current_company_id: Schema.NullOr(Schema.String),
  memberships: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      company_id: Schema.String,
      company_name: Schema.String,
      company_org_code: OrgCodeSchema,
      role: RoleSchema,
      joined_at: Schema.String,
    }),
  ),
});

export type CompanyState = typeof CompanyState.Type;

const AvatarUploadTokenRequest = Schema.Struct({
  type: Schema.Literal("blob.generate-client-token"),
  payload: Schema.Struct({
    pathname: Schema.String,
    clientPayload: Schema.optional(Schema.NullOr(Schema.String)),
    multipart: Schema.optional(Schema.Boolean),
  }),
});

export class AccountGroup extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("memberships", "/api/account/memberships", { success: CompanyState }),
    HttpApiEndpoint.post("switchCompany", "/api/account/current-company", {
      payload: Schema.Struct({ company_id: Id }),
      success: Schema.Struct({ ...Ok.fields, company_id: Schema.String }),
      error: Forbidden,
    }),
    HttpApiEndpoint.post("deleteAccount", "/api/account/delete", {
      success: Ok,
      error: [LastOwner, NotFound],
    }),
    HttpApiEndpoint.post("avatarUploadToken", "/api/account/avatar/upload-token", {
      payload: AvatarUploadTokenRequest,
      success: Schema.Struct({
        type: Schema.Literal("blob.generate-client-token"),
        clientToken: Schema.String,
      }),
    }),
  )
  .middleware(Authenticated) {}
