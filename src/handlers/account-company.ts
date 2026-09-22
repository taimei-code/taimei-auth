import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import type { OrgCode } from "@/db/repositories/company";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { updateCompanyInfo } from "../company/update";
import { requireActor, requireMembership } from "../membership/guard";
import { MembershipRepo } from "../membership/ports";
import { parseZodBody, parseZodBodyWithDetails } from "./parse-body";
import { runRoute } from "./run-route";

export const accountCompany = new Hono();

const companyBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    org_code: z.enum(["PERSONAL", "CORPORATE"] as const satisfies readonly OrgCode[]),
  })
  .transform((d) => ({ name: d.name, orgCode: d.org_code }));

accountCompany.get("/api/account/memberships", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const membershipRepo = yield* MembershipRepo;
      const rows = yield* membershipRepo.findMembershipsByUserId(actor.id);
      const activeMemberships = rows.filter((m) => m.companyActivationStatus === "ACTIVE");
      const lastUsedCompanyId = actor.lastUsedCompanyId;
      const currentCompanyId =
        lastUsedCompanyId && activeMemberships.some((m) => m.companyId === lastUsedCompanyId)
          ? lastUsedCompanyId
          : (activeMemberships.at(0)?.companyId ?? null);

      return c.json({
        current_company_id: currentCompanyId,
        memberships: activeMemberships.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          company_name: row.companyName,
          company_org_code: row.companyOrgCode,
          role: row.role,
          joined_at: row.joinedAt.toISOString(),
        })),
      });
    }),
  ),
);

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

accountCompany.post("/api/account/companies", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseZodBodyWithDetails(c, companyBody);
      const result = yield* createSignupCompany(actor.id, input);
      return c.json(serializeCreatedCompany(result));
    }),
  ),
);

// `/:companyId` より前に置く。segment 数が同じ static と param は登録順で決まる。
accountCompany.post("/api/account/companies/add", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseZodBodyWithDetails(c, companyBody);
      const created = yield* addCompany(actor.id, input);
      return c.json(serializeCreatedCompany(created));
    }),
  ),
);

accountCompany.post("/api/account/companies/:companyId", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor } = yield* requireMembership(c.req.raw.headers, companyId, "OWNER");
      const input = yield* parseZodBody(c, companyBody);
      const result = yield* updateCompanyInfo({ actorUserId: actor.id, companyId, input });
      return c.json({
        company: {
          id: result.company.id,
          name: result.company.name,
          org_code: result.company.orgCode,
          activation_status: result.company.activationStatus,
        },
      });
    }),
  ),
);

accountCompany.post("/api/account/companies/:companyId/delete", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor } = yield* requireMembership(c.req.raw.headers, companyId, "OWNER");
      const result = yield* deleteCompany(actor.id, companyId);
      return c.json({ ok: true, account_deleted: result.actorDeleted });
    }),
  ),
);
