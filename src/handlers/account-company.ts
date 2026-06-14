import { Hono } from "hono";
import { z } from "zod";

import { getSessionActorId } from "./session-actor";
import { runInTransaction } from "@/db/transaction";
import {
  findCompanyById,
  softDeleteCompany,
  updateCompany,
  type OrgCode,
} from "@/db/repositories/company";
import { findMembership, findMembershipsByUserId } from "@/db/repositories/membership";
import { recordCompanyDeleted, recordCompanyUpdated } from "@/db/repositories/audit-log";
import { findUserById } from "@/db/repositories/user";
import { addCompany, createSignupCompany, type CreatedCompany } from "../company/create";

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

accountCompany.get("/api/account/memberships", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const [rows, userRow] = await Promise.all([
    findMembershipsByUserId(userId),
    findUserById(userId),
  ]);
  const active = rows.filter((r) => r.companyActivationStatus === "ACTIVE");
  // current_company_id は user.last_used_company_id。ただし当該 company が ACTIVE membership に
  // 無い (削除済 / 未設定) 場合は先頭にフォールバックし SPA の「現在の事業所」表示を安定させる。
  const lastUsed = userRow?.lastUsedCompanyId ?? null;
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
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const parsed = companyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_argument", details: parsed.error.flatten() }, 400);
  }

  const result = await createSignupCompany(userId, {
    name: parsed.data.name,
    orgCode: parsed.data.org_code as OrgCode,
  });
  if (!result.ok) {
    return c.json({ error: "already_exists" }, 409);
  }
  return c.json(serializeCreatedCompany(result));
});

// 既存 user が 2 つ目以降の事業所を追加する。membership 有無を問わず作成し OWNER になる。
// ルート登録順の制約: この add route は下の `/:companyId` param route より「前」に置くこと。
// Hono 4.7 SmartRouter は静的セグメントを常には優先せず登録順依存で、後ろに置くと
// `/companies/add` が `:companyId="add"` として update handler に吸われる (使い捨ての検証コードで実測)。
// 順序依存は「セグメント数が一致する static vs param」だけ。`/:companyId/delete` が `/:companyId`
// の後ろでも安全なのはセグメント数が違い競合しないため (= `/add` だけがこの予防順序を要する)。
accountCompany.post("/api/account/companies/add", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const parsed = companyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_argument", details: parsed.error.flatten() }, 400);
  }

  const created = await addCompany(userId, {
    name: parsed.data.name,
    orgCode: parsed.data.org_code as OrgCode,
  });
  return c.json(serializeCreatedCompany(created));
});

// PATCH 相当: 事業所の name / org_code を編集 (OWNER のみ)。before/after diff を audit。
accountCompany.post("/api/account/companies/:companyId", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const actorMembership = await findMembership(userId, companyId);
  if (!actorMembership || actorMembership.role !== "OWNER") {
    return c.json({ error: "forbidden" }, 403);
  }

  const parsed = companyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_argument" }, 400);
  const name = parsed.data.name.trim();
  const orgCode = parsed.data.org_code as OrgCode;

  // before の取得を tx 内で行い、audit の before/after diff が並行更新でずれないようにする。
  const updated = await runInTransaction(async (tx) => {
    const before = await findCompanyById(companyId, tx);
    if (!before || before.activationStatus !== "ACTIVE") return null;
    const row = await updateCompany(companyId, { name, orgCode }, tx);
    if (!row) return null;
    await recordCompanyUpdated(
      {
        actor_user_id: userId,
        company_id: companyId,
        before: { name: before.name, org_code: before.orgCode as OrgCode },
        after: { name, org_code: orgCode },
      },
      tx,
    );
    return row;
  });

  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({
    company: {
      id: updated.id,
      name: updated.name,
      org_code: updated.orgCode,
      activation_status: updated.activationStatus,
    },
  });
});

// 事業所の soft delete (OWNER のみ)。activation_status=DELETED にし membership / invitation は残す。
// 削除した company を current にしていた user の last_used_company_id は次回 getCompanyState で
// fallback されるため、ここでは触らない (membership は残るため active filter で自然に除外される)。
accountCompany.post("/api/account/companies/:companyId/delete", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const actorMembership = await findMembership(userId, companyId);
  if (!actorMembership || actorMembership.role !== "OWNER") {
    return c.json({ error: "forbidden" }, 403);
  }

  const deleted = await runInTransaction(async (tx) => {
    const row = await softDeleteCompany(companyId, tx);
    if (!row) return null;
    await recordCompanyDeleted(
      { actor_user_id: userId, company_id: companyId, name_at_deletion: row.name },
      tx,
    );
    return row;
  });

  if (!deleted) return c.json({ error: "not_found_or_already_deleted" }, 404);
  return c.json({ ok: true });
});
