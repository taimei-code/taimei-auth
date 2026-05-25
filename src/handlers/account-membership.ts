import { Hono } from "hono";
import { z } from "zod";

import { getSessionActorId } from "./session-actor";
import { runInTransaction } from "@/db/transaction";
import {
  OwnerInvariantViolation,
  deleteMembership,
  findMembership,
  updateMembershipRole,
  withOwnerLockGuard,
  type Role,
} from "@/db/repositories/membership";
import { findUserById, updateUserLastUsedCompany } from "@/db/repositories/user";
import {
  recordCompanySwitched,
  recordMembershipRemoved,
  recordOwnershipTransferred,
  recordRoleChanged,
} from "@/db/repositories/audit-log";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z.object({ company_id: z.string().min(1).max(64) });
const updateRoleBody = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });
const transferOwnershipBody = z.object({ to_user_id: z.string().min(1).max(64) });

function canManageMembers(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// POST 事業所切替。target の active membership を持つことを verify し user.last_used_company_id を更新。
// secondaryStorage 構成では session 列でなく user.last_used_company_id が SDK companyId の source。
accountMembership.post("/api/account/current-company", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const parsed = setCurrentCompanyBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_argument" }, 400);
  const targetCompanyId = parsed.data.company_id;

  const userRow = await findUserById(userId);
  const fromCompanyId = userRow?.lastUsedCompanyId ?? null;
  if (fromCompanyId === targetCompanyId) {
    return c.json({ ok: true, company_id: targetCompanyId });
  }

  // membership の存在は tx 内で再確認する。tx 外 check と更新の間に除名が入ると
  // 無効な company_id を last_used_company_id に書き込んでしまう (TOCTOU) ため。
  const switched = await runInTransaction(async (tx) => {
    const target = await findMembership(userId, targetCompanyId, tx);
    if (!target) return false;
    await updateUserLastUsedCompany(userId, targetCompanyId, tx);
    await recordCompanySwitched(
      { actor_user_id: userId, from_company_id: fromCompanyId, to_company_id: targetCompanyId },
      tx,
    );
    return true;
  });

  if (!switched) return c.json({ error: "forbidden" }, 403);
  return c.json({ ok: true, company_id: targetCompanyId });
});

// POST role 変更。RBAC: OWNER は全 role 設定可、ADMIN は MEMBER↔ADMIN のみ (OWNER 昇格 / OWNER 操作は不可)。
// OWNER を降格する変更は withOwnerLockGuard で「OWNER ≥ 1」を保証。
accountMembership.post(
  "/api/account/companies/:companyId/members/:targetUserId/role",
  async (c) => {
    const actorUserId = await getSessionActorId(c.req.raw.headers);
    if (!actorUserId) return c.json({ error: "unauthorized" }, 401);
    const companyId = c.req.param("companyId");
    const targetUserId = c.req.param("targetUserId");

    const parsed = updateRoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_argument" }, 400);
    const nextRole = parsed.data.role as Role;

    const actorMembership = await findMembership(actorUserId, companyId);
    if (!actorMembership || !canManageMembers(actorMembership.role)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const targetMembership = await findMembership(targetUserId, companyId);
    if (!targetMembership) return c.json({ error: "not_found" }, 404);

    const beforeRole = targetMembership.role as Role;
    // ADMIN は OWNER を操作できず、OWNER 昇格も承認できない (OWNER のみ可)。
    const touchesOwner = beforeRole === "OWNER" || nextRole === "OWNER";
    if (touchesOwner && actorMembership.role !== "OWNER") {
      return c.json({ error: "forbidden" }, 403);
    }
    if (beforeRole === nextRole) {
      return c.json({ ok: true });
    }

    const apply = (tx: Parameters<Parameters<typeof runInTransaction>[0]>[0]) =>
      updateMembershipRole(targetUserId, companyId, nextRole, tx).then(() =>
        recordRoleChanged(
          {
            actor_user_id: actorUserId,
            company_id: companyId,
            target_user_id: targetUserId,
            before_role: beforeRole,
            after_role: nextRole,
          },
          tx,
        ),
      );

    // OWNER → 非 OWNER の降格のみ OWNER 数が減るため lock guard で保護。
    const demotesOwner = beforeRole === "OWNER" && nextRole !== "OWNER";
    const result = await runInTransaction((tx) =>
      demotesOwner ? withOwnerLockGuard(tx, companyId, apply) : apply(tx),
    ).catch((e) => {
      if (e instanceof OwnerInvariantViolation) return "owner_invariant";
      throw e;
    });
    if (result === "owner_invariant") {
      return c.json({ error: "last_owner" }, 409);
    }
    return c.json({ ok: true });
  },
);

// POST メンバー削除 (除名 / 退会)。本人 (退会) または OWNER/ADMIN (除名) が可能。
// OWNER を削除する場合は withOwnerLockGuard で「OWNER ≥ 1」を保証。
accountMembership.post(
  "/api/account/companies/:companyId/members/:targetUserId/remove",
  async (c) => {
    const actorUserId = await getSessionActorId(c.req.raw.headers);
    if (!actorUserId) return c.json({ error: "unauthorized" }, 401);
    const companyId = c.req.param("companyId");
    const targetUserId = c.req.param("targetUserId");

    const actorMembership = await findMembership(actorUserId, companyId);
    if (!actorMembership) return c.json({ error: "forbidden" }, 403);

    const isSelf = actorUserId === targetUserId;
    if (!isSelf && !canManageMembers(actorMembership.role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const targetMembership = await findMembership(targetUserId, companyId);
    if (!targetMembership) return c.json({ error: "not_found" }, 404);

    const targetRole = targetMembership.role as Role;
    // ADMIN は OWNER を除名できない (OWNER 同士 / 本人退会は可)。
    if (targetRole === "OWNER" && !isSelf && actorMembership.role !== "OWNER") {
      return c.json({ error: "forbidden" }, 403);
    }

    const apply = (tx: Parameters<Parameters<typeof runInTransaction>[0]>[0]) =>
      deleteMembership(targetUserId, companyId, tx).then(() =>
        recordMembershipRemoved(
          {
            actor_user_id: actorUserId,
            company_id: companyId,
            removed_user_id: targetUserId,
            role_at_removal: targetRole,
          },
          tx,
        ),
      );

    const removesOwner = targetRole === "OWNER";
    const result = await runInTransaction((tx) =>
      removesOwner ? withOwnerLockGuard(tx, companyId, apply) : apply(tx),
    ).catch((e) => {
      if (e instanceof OwnerInvariantViolation) return "owner_invariant";
      throw e;
    });
    if (result === "owner_invariant") {
      return c.json({ error: "last_owner" }, 409);
    }
    return c.json({ ok: true });
  },
);

// POST オーナー委譲 (OWNER のみ)。target を OWNER 昇格 + actor を ADMIN 降格を 1 transaction で。
// 「唯一の OWNER が抜けたい」場合に先に委譲してから退会する導線 (Q5)。actor は OWNER のまま
// 委譲後に降格するため、委譲中に OWNER ゼロにはならない (lock guard 不要だが念のため包む)。
accountMembership.post("/api/account/companies/:companyId/transfer-ownership", async (c) => {
  const actorUserId = await getSessionActorId(c.req.raw.headers);
  if (!actorUserId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const parsed = transferOwnershipBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_argument" }, 400);
  const toUserId = parsed.data.to_user_id;
  if (toUserId === actorUserId) return c.json({ error: "invalid_argument" }, 400);

  const actorMembership = await findMembership(actorUserId, companyId);
  if (!actorMembership || actorMembership.role !== "OWNER") {
    return c.json({ error: "forbidden" }, 403);
  }
  const targetMembership = await findMembership(toUserId, companyId);
  if (!targetMembership) return c.json({ error: "not_found" }, 404);
  // 既に OWNER の相手への「委譲」は actor を無意味に降格し audit も誤解を生むため弾く。
  if (targetMembership.role === "OWNER") {
    return c.json({ error: "already_owner" }, 400);
  }

  await runInTransaction((tx) =>
    withOwnerLockGuard(tx, companyId, async (tx2) => {
      await updateMembershipRole(toUserId, companyId, "OWNER", tx2);
      await updateMembershipRole(actorUserId, companyId, "ADMIN", tx2);
      await recordOwnershipTransferred(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          from_user_id: actorUserId,
          to_user_id: toUserId,
        },
        tx2,
      );
    }),
  );

  return c.json({ ok: true });
});
