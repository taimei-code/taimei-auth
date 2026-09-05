import { Effect } from "effect";
import { type Context, Hono } from "hono";
import { z } from "zod";

import type { OrgCode } from "@/db/repositories/company";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { updateCompanyInfo } from "../company/update";
import { requireActor, requireMembership } from "../membership/guard";
import { MembershipRepo } from "../membership/ports";
import { parseZodBody } from "./parse-body";
import { runRoute } from "./run-route";

// SPA から呼ばれる事業所操作。Connect RPC (/rpc/*) は X-Service-Key 必須で browser から付与できないため、
// 同等処理を session cookie を信頼する Hono ルートとして提供する (avatar-upload.ts と同パターン)。
// 各 route は Effect program を runRoute (唯一の写像点) で走らせる (ADR-0017)。
export const accountCompany = new Hono();

// 作成 (signup / add) / 編集の body は同形。1 箇所に集約して制約が route 間で silent にずれるのを防ぐ。
const companyBody = z.object({
  name: z.string().trim().min(1).max(100),
  org_code: z.enum(["PERSONAL", "CORPORATE"]),
});

// parse 失敗 → InvalidArgument (400) は parseZodBody が担う。400 に zod details を載せるのは作成系だけ (wire 契約)。
const parseCompanyBody = (c: Context, opts: { withDetails: boolean }) =>
  parseZodBody(c, companyBody, {
    withDetails: opts.withDetails,
    transform: (d) => ({ name: d.name, orgCode: d.org_code as OrgCode }),
  });

accountCompany.get("/api/account/memberships", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const membershipRepo = yield* MembershipRepo;
      const rows = yield* membershipRepo.findMembershipsByUserId(actor.id);
      const activeMemberships = rows.filter((m) => m.companyActivationStatus === "ACTIVE");
      // current_company_id は user.last_used_company_id。当該 company が ACTIVE membership に無い場合は
      // 先頭にフォールバックし SPA の「現在の事業所」表示を安定させる。
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

// 作成系 (signup / add) の response は同形。HTTP shape は handler 層の責務なのでここで組む。
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

// signup フローの「最初の 1 事業所」作成。0 件ガード / 409 race 直列化は createSignupCompany が担う。
accountCompany.post("/api/account/companies", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseCompanyBody(c, { withDetails: true });
      const result = yield* createSignupCompany(actor.id, input);
      return c.json(serializeCreatedCompany(result));
    }),
  ),
);

// 既存 user が 2 つ目以降の事業所を追加する (membership 有無を問わず OWNER になる)。この route は下の
// `/:companyId` より前に置くこと — 同 segment 数の static vs param の登録順依存 (src/CLAUDE.md gotcha)。
accountCompany.post("/api/account/companies/add", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseCompanyBody(c, { withDetails: true });
      const created = yield* addCompany(actor.id, input);
      return c.json(serializeCreatedCompany(created));
    }),
  ),
);

// PATCH 相当: name / org_code を編集 (OWNER のみ)。diff の audit と tx 所有は updateCompanyInfo use-case。
accountCompany.post("/api/account/companies/:companyId", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor } = yield* requireMembership(c.req.raw.headers, companyId, "OWNER");
      const input = yield* parseCompanyBody(c, { withDetails: false });
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

// 事業所削除 (OWNER のみ)。company は soft delete、membership は物理削除し、所属 0 件になった元メンバーは
// 連動でアカウント削除する (orchestration は deleteCompany use-case。詳細: ADR-0010 / ADR-0012 (C))。
accountCompany.post("/api/account/companies/:companyId/delete", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const companyId = c.req.param("companyId");
      const result = yield* deleteCompany(actor.id, companyId);
      // account_deleted=true は actor 自身が orphan として消えたことを示し、client は full reload 遷移する。
      return c.json({ ok: true, account_deleted: result.actorDeleted });
    }),
  ),
);
