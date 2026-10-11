import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { OrgCode } from "@/db/repositories/company";
import { CurrentActor } from "../account/actor-contract";
import type { OrgCodeSchema } from "../company/company-contract";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { updateCompanyInfo } from "../company/update";
import { requireMembershipOf } from "../membership/guard";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

const _orgCodeSchemaIsExhaustive: [OrgCode, typeof OrgCodeSchema.Type] extends [
  typeof OrgCodeSchema.Type,
  OrgCode,
]
  ? true
  : never = true;

const serializeCompany = (company: CreatedCompany["company"]) => ({
  id: company.id,
  name: company.name,
  org_code: company.orgCode,
  activation_status: company.activationStatus,
});

const serializeCreatedCompany = ({ company, membership }: CreatedCompany) => ({
  company: { ...serializeCompany(company), created_at: company.createdAt.toISOString() },
  membership: {
    id: membership.id,
    role: membership.role,
    company_id: membership.companyId,
    joined_at: membership.joinedAt.toISOString(),
  },
});

const toCompanyInput = (payload: { name: string; org_code: OrgCode }) => ({
  name: payload.name,
  orgCode: payload.org_code,
});

export const CompanyHandlers = HttpApiBuilder.group(SpaApi, "company", (handlers) =>
  handlers.handleAll({
    create: Effect.fnUntraced(function* ({ payload }) {
      const actor = yield* CurrentActor;
      return serializeCreatedCompany(yield* createSignupCompany(actor.id, toCompanyInput(payload)));
    }, dieOnBoundary),
    add: Effect.fnUntraced(function* ({ payload }) {
      const actor = yield* CurrentActor;
      return serializeCreatedCompany(yield* addCompany(actor.id, toCompanyInput(payload)));
    }, dieOnBoundary),
    update: Effect.fnUntraced(function* ({ params, payload }) {
      const actor = yield* CurrentActor;
      yield* requireMembershipOf(actor, params.companyId, "OWNER");
      const result = yield* updateCompanyInfo({
        actorUserId: actor.id,
        companyId: params.companyId,
        input: toCompanyInput(payload),
      });
      return { company: serializeCompany(result.company) };
    }, dieOnBoundary),
    delete: Effect.fnUntraced(function* ({ params }) {
      const actor = yield* CurrentActor;
      yield* requireMembershipOf(actor, params.companyId, "OWNER");
      const result = yield* deleteCompany(actor.id, params.companyId);
      return { ok: true as const, account_deleted: result.actorDeleted };
    }, dieOnBoundary),
  }),
);
