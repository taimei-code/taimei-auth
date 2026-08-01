import { type Context, Hono } from "hono";
import { z } from "zod";

import type { OrgCode } from "@/db/repositories/company";
import { findMembershipsByUserId } from "@/db/repositories/membership";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { updateCompanyInfo } from "../company/update";
import {
  guardErrorResponse,
  reasonToGuardError,
  requireActor,
  requireMembership,
  resolveParseBody,
} from "../membership/guard";
import { parseZodBody } from "./parse-body";

// SPA から呼ばれる事業所操作。Connect RPC (/rpc/*) は X-Service-Key 必須で
// browser からは付与不能なため、同等処理を better-auth セッション cookie を信頼する
// Hono ルートとして提供する (handlers/avatar-upload.ts と同パターン)。
export const accountCompany = new Hono();

// 事業所の作成 (signup / add) / 編集で受け取る body は同形 (名前 + 事業形態)。1 箇所に集約して
// max 長などの制約が route 間で silent にずれるのを防ぐ。
const companyBody = z.object({
  name: z.string().trim().min(1).max(100),
  org_code: z.enum(["PERSONAL", "CORPORATE"]),
});

// parse 失敗 → 400 の写像は guard 層の resolveParseBody に集約 (他 route と同じ shape を保つ)。
// details は「signup 作成 / add」のみ付与し、編集 route は省略する現行契約を withDetails が持つ。
const parseCompanyBody = (c: Context, options: { withDetails?: boolean } = {}) =>
  resolveParseBody(
    parseZodBody(c, companyBody, {
      ...options,
      transform: (d) => ({ name: d.name, orgCode: d.org_code as OrgCode }),
    }),
  );

accountCompany.get("/api/account/memberships", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);
  const userId = actorResult.actor.id;

  const rows = await findMembershipsByUserId(userId);
  const active = rows.filter((r) => r.companyActivationStatus === "ACTIVE");
  // current_company_id は user.last_used_company_id (guard が読んだ user 行から受け取る)。
  // 当該 company が ACTIVE membership に無い (削除済 / 未設定) 場合は先頭にフォールバックし
  // SPA の「現在の事業所」表示を安定させる。
  const lastUsed = actorResult.actor.lastUsedCompanyId;
  const currentCompanyId =
    lastUsed && active.some((m) => m.companyId === lastUsed)
      ? lastUsed
      : (active.at(0)?.companyId ?? null);

  return c.json({
    current_company_id: currentCompanyId,
    memberships: active.map((row) => ({
      id: row.id,
      company_id: row.companyId,
      company_name: row.companyName,
      company_org_code: row.companyOrgCode,
      role: row.role,
      joined_at: row.joinedAt.toISOString(),
    })),
  });
});

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
accountCompany.post("/api/account/companies", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);
  const userId = actorResult.actor.id;

  const parsed = await parseCompanyBody(c, { withDetails: true });
  if (!parsed.ok) return guardErrorResponse(parsed);

  const result = await createSignupCompany(userId, parsed.data);
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  return c.json(serializeCreatedCompany(result));
});

// 既存 user が 2 つ目以降の事業所を追加する。membership 有無を問わず作成し OWNER になる。
// ルート登録順の制約: この add route は下の `/:companyId` param route より「前」に置くこと。
// Hono 4.7 SmartRouter は静的セグメントを常には優先せず登録順依存で、後ろに置くと
// `/companies/add` が `:companyId="add"` として update handler に吸われる (使い捨ての検証コードで実測)。
// 順序依存は「セグメント数が一致する static vs param」だけ。`/:companyId/delete` が `/:companyId`
// の後ろでも安全なのはセグメント数が違い競合しないため (= `/add` だけがこの予防順序を要する)。
accountCompany.post("/api/account/companies/add", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);
  const userId = actorResult.actor.id;

  const parsed = await parseCompanyBody(c, { withDetails: true });
  if (!parsed.ok) return guardErrorResponse(parsed);

  const created = await addCompany(userId, parsed.data);
  return c.json(serializeCreatedCompany(created));
});

// PATCH 相当: 事業所の name / org_code を編集 (OWNER のみ)。before/after diff の audit と tx 所有は
// updateCompanyInfo use-case。
accountCompany.post("/api/account/companies/:companyId", async (c) => {
  const companyId = c.req.param("companyId");
  const membershipResult = await requireMembership(c.req.raw.headers, companyId, "OWNER");
  if (!membershipResult.ok) return guardErrorResponse(membershipResult);

  const parsed = await parseCompanyBody(c);
  if (!parsed.ok) return guardErrorResponse(parsed);

  const result = await updateCompanyInfo({
    actorUserId: membershipResult.actor.id,
    companyId,
    input: parsed.data,
  });
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  return c.json({
    company: {
      id: result.company.id,
      name: result.company.name,
      org_code: result.company.orgCode,
      activation_status: result.company.activationStatus,
    },
  });
});

// 事業所削除 (OWNER のみ)。company は soft delete だが所属 (membership) は物理削除し、所属 0 件に
// なった元メンバー (最後の事業所を消した OWNER 自身を含む) は連動でアカウント削除する。orchestration は
// deleteCompany use-case (単一 tx)。設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
// 現状維持 route (認可が use-case tx 内融合、レイヤ地図上の正位置)。ADR-0012 (C) 参照。
accountCompany.post("/api/account/companies/:companyId/delete", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);
  const userId = actorResult.actor.id;
  const companyId = c.req.param("companyId");

  const result = await deleteCompany(userId, companyId);
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  // account_deleted=true は actor 自身が orphan として消えたことを示す。client は
  // redirectAfterAuthChange("deleteAccount") でログアウト先へ full reload 遷移する
  // (web/src/pages/account/CompanySettings.tsx)。
  return c.json({ ok: true, account_deleted: result.actorDeleted });
});
