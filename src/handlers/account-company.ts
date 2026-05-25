import { Hono } from "hono";
import { z } from "zod";

import { getSessionActorId } from "./session-actor";
import { runInTransaction } from "@/db/transaction";
import {
  findCompanyById,
  generateCompanyId,
  insertCompany,
  softDeleteCompany,
  updateCompany,
  type OrgCode,
} from "@/db/repositories/company";
import {
  findMembership,
  findMembershipsByUserId,
  generateMembershipId,
  insertMembership,
  lockUserForCompanyCreation,
} from "@/db/repositories/membership";
import {
  recordCompanyCreated,
  recordCompanyDeleted,
  recordCompanyUpdated,
} from "@/db/repositories/audit-log";
import { findUserById, updateUserLastUsedCompany } from "@/db/repositories/user";

// SPA から呼ばれる事業所操作。Connect RPC (/rpc/*) は X-Service-Key 必須で
// browser からは付与不能なため、同等処理を better-auth セッション cookie を信頼する
// Hono ルートとして提供する (handlers/avatar-upload.ts と同パターン)。
export const accountCompany = new Hono();

const createCompanyBody = z.object({
  name: z.string().trim().min(1).max(100),
  org_code: z.enum(["PERSONAL", "CORPORATE"]),
});

const updateCompanyBody = z.object({
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

accountCompany.post("/api/account/companies", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const parsed = createCompanyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_argument", details: parsed.error.flatten() }, 400);
  }

  const companyId = generateCompanyId();
  const membershipId = generateMembershipId();
  const orgCode = parsed.data.org_code as OrgCode;
  const name = parsed.data.name;

  // 2 tab 同時 submit (signup 直後 membership 0 件) の race を直列化する。
  // advisory lock で per-user 排他にした上で tx 内で再 check し、先着が membership を作っていれば
  // 後着は null を返して 409。READ COMMITTED では tx 外 check + INSERT だけでは両方成功しうる (TOCTOU)。
  const created = await runInTransaction(async (tx) => {
    await lockUserForCompanyCreation(tx, userId);
    const existing = await findMembershipsByUserId(userId, tx);
    if (existing.length > 0) {
      return null;
    }
    const newCompany = await insertCompany({ id: companyId, name, orgCode }, tx);
    const newMembership = await insertMembership(
      { id: membershipId, userId, companyId, role: "OWNER" },
      tx,
    );
    await updateUserLastUsedCompany(userId, companyId, tx);
    await recordCompanyCreated(
      { actor_user_id: userId, company_id: companyId, name, org_code: orgCode },
      tx,
    );
    return { company: newCompany, membership: newMembership };
  });

  if (!created) {
    return c.json({ error: "already_exists" }, 409);
  }
  const { company, membership } = created;

  return c.json({
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

  const parsed = updateCompanyBody.safeParse(await c.req.json().catch(() => null));
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
