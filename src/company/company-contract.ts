import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { LastOwner } from "../membership/errors";
import { Forbidden, NotFound } from "../membership/guard/errors";
import { ORG_CODES } from "../../db/enums";
import { RoleSchema } from "../membership/membership-contract";
import { AccountDeleted, CompanyParams } from "../spa-contract-schemas";
import { AlreadyExists } from "./errors";

export const OrgCodeSchema = Schema.Literals(ORG_CODES);

export const CompanyNameSchema = Schema.Trim.check(Schema.isBetweenLength(1, 100));

const CompanyInput = Schema.Struct({
  name: CompanyNameSchema,
  org_code: OrgCodeSchema,
});

const CompanyFields = {
  id: Schema.String,
  name: Schema.String,
  org_code: OrgCodeSchema,
  activation_status: Schema.String,
};

const CreatedCompany = Schema.Struct({
  company: Schema.Struct({ ...CompanyFields, created_at: Schema.String }),
  membership: Schema.Struct({
    id: Schema.String,
    role: RoleSchema,
    company_id: Schema.String,
    joined_at: Schema.String,
  }),
});

export class CompanyGroup extends HttpApiGroup.make("company")
  .add(
    HttpApiEndpoint.post("create", "/api/account/companies", {
      payload: CompanyInput,
      success: CreatedCompany,
      error: AlreadyExists,
    }),
    HttpApiEndpoint.post("add", "/api/account/companies/add", {
      payload: CompanyInput,
      success: CreatedCompany,
    }),
    HttpApiEndpoint.post("update", "/api/account/companies/:companyId", {
      params: CompanyParams,
      payload: CompanyInput,
      success: Schema.Struct({ company: Schema.Struct(CompanyFields) }),
      error: [Forbidden, NotFound],
    }),
    HttpApiEndpoint.post("delete", "/api/account/companies/:companyId/delete", {
      params: CompanyParams,
      success: AccountDeleted,
      error: [Forbidden, LastOwner],
    }),
  )
  .middleware(Authenticated) {}
