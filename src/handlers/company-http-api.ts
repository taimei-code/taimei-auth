import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import type { OrgCode } from "@/db/repositories/company";
import type { OrgCodeSchema } from "../account/account-contract";
import { CurrentActor } from "../account/actor-contract";
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

const serializeCreatedCompany = ({ company, membership }: CreatedCompany) => ({
  company: {
    id: company.id,
    name: company.name,
    org_code: company.orgCode,
    activation_status: company.activationStatus,
    created_at: company.createdAt.toISOString(),
  },
  membership: {
    id: membership.id,
    role: membership.role,
    company_id: membership.companyId,
    joined_at: membership.joinedAt.toISOString(),
  },
});

const toInput = (payload: { name: string; org_code: "PERSONAL" | "CORPORATE" }) => ({
  name: payload.name,
  orgCode: payload.org_code,
});

export const CompanyHandlers = HttpApiBuilder.group(SpaApi, "company", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        return serializeCreatedCompany(yield* createSignupCompany(actor.id, toInput(payload)));
      }).pipe(dieOnBoundary),
    )
    .handle("add", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        return serializeCreatedCompany(yield* addCompany(actor.id, toInput(payload)));
      }).pipe(dieOnBoundary),
    )
    .handle("update", ({ params, payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        yield* requireMembershipOf(actor, params.companyId, "OWNER");
        const result = yield* updateCompanyInfo({
          actorUserId: actor.id,
          companyId: params.companyId,
          input: toInput(payload),
        });
        return {
          company: {
            id: result.company.id,
            name: result.company.name,
            org_code: result.company.orgCode,
            activation_status: result.company.activationStatus,
          },
        };
      }).pipe(dieOnBoundary),
    )
    .handle("delete", ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        yield* requireMembershipOf(actor, params.companyId, "OWNER");
        const result = yield* deleteCompany(actor.id, params.companyId);
        return { ok: true as const, account_deleted: result.actorDeleted };
      }).pipe(dieOnBoundary),
    ),
);
