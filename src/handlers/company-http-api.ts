import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import type { OrgCode } from "../company/org-code";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { updateCompanyInfo } from "../company/update";
import { requireMembershipOf } from "../membership/guard";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

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
      const member = yield* requireMembershipOf(yield* CurrentActor, params.companyId, "OWNER");
      const result = yield* updateCompanyInfo(member, toCompanyInput(payload));
      return { company: serializeCompany(result.company) };
    }, dieOnBoundary),
    delete: Effect.fnUntraced(function* ({ params }) {
      const member = yield* requireMembershipOf(yield* CurrentActor, params.companyId, "OWNER");
      const result = yield* deleteCompany(member);
      return { ok: true as const, account_deleted: result.actorDeleted };
    }, dieOnBoundary),
  }),
);
