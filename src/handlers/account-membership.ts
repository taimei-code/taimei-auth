import { Hono } from "hono";
import { z } from "zod";

import {
  guardErrorResponse,
  requireActor,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { parseZodBody } from "./parse-body";
import { runInTransaction } from "@/db/transaction";
import {
  OwnerInvariantViolation,
  findMembership,
  updateMembershipRole,
  withOwnerLockGuard,
  type Role,
} from "@/db/repositories/membership";
import { findUserById, updateUserLastUsedCompany } from "@/db/repositories/user";
import {
  recordCompanySwitched,
  recordOwnershipTransferred,
  recordRoleChanged,
} from "@/db/repositories/audit-log";
import { removeMember } from "../membership/remove";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z.object({ company_id: z.string().min(1).max(64) });
const updateRoleBody = z.object({ role: z.enum(["OWNER", "ADMIN", "MEMBER"]) });
const transferOwnershipBody = z.object({ to_user_id: z.string().min(1).max(64) });

// POST 事業所切替。target の active membership を持つことを verify し user.last_used_company_id を更新。
// secondaryStorage 構成では session 列でなく user.last_used_company_id が SDK companyId の source。
// 現状維持 route (認可が tx 内融合の TOCTOU 対策の一部)。ADR-0012 (C) 参照。
accountMembership.post("/api/account/current-company", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);
  const userId = actorResult.actor.id;

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
// entry (requireRoleChange) が 401→400→403 (ADMIN)→404→403 (canChangeRole) を担う。
accountMembership.post(
  "/api/account/companies/:companyId/members/:targetUserId/role",
  async (c) => {
    const companyId = c.req.param("companyId");
    const targetUserId = c.req.param("targetUserId");

    const guardResult = await requireRoleChange({
      headers: c.req.raw.headers,
      companyId,
      targetUserId,
      parseBody: parseZodBody(c, updateRoleBody, {
        transform: (d) => ({ nextRole: d.role as Role }),
      }),
    });
    if (!guardResult.ok) return guardErrorResponse(guardResult);
    const { actor, targetRole: beforeRole, nextRole } = guardResult;

    if (beforeRole === nextRole) {
      return c.json({ ok: true });
    }

    const actorUserId = actor.id;
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
// 認可は entry (requireRemoval) が 401→403 (membership)→403 (canAttemptRemoval)→404→403 (canRemoveTarget)
// の順で担い、mutation (membership 削除 + 所属 0 件なら account 連動削除 + OWNER≥1 保証) は
// removeMember use-case が担う (ADR-0010 D2)。
accountMembership.post(
  "/api/account/companies/:companyId/members/:targetUserId/remove",
  async (c) => {
    const companyId = c.req.param("companyId");
    const targetUserId = c.req.param("targetUserId");

    const guardResult = await requireRemoval({
      headers: c.req.raw.headers,
      companyId,
      targetUserId,
    });
    if (!guardResult.ok) return guardErrorResponse(guardResult);
    const { actor, targetRole } = guardResult;

    const result = await removeMember(actor.id, targetUserId, companyId, targetRole);
    if (result === "owner_invariant") {
      return c.json({ error: "last_owner" }, 409);
    }
    // 本人が最後の所属を退会した場合 account_deleted=true。client はログアウト遷移する (UX は後続 PR)。
    return c.json({ ok: true, account_deleted: result.accountDeleted });
  },
);

// POST オーナー委譲 (OWNER のみ)。target を OWNER 昇格 + actor を ADMIN 降格を 1 transaction で。
// 「唯一の OWNER が抜けたい」場合に先に委譲してから退会する導線 (Q5)。actor は OWNER のまま
// 委譲後に降格するため、委譲中に OWNER ゼロにはならない (lock guard 不要だが念のため包む)。
// entry (requireTransferOwnership) が 401→400 (parse + self)→403 (OWNER)→404→400 (already_owner) を担う。
accountMembership.post("/api/account/companies/:companyId/transfer-ownership", async (c) => {
  const companyId = c.req.param("companyId");

  const guardResult = await requireTransferOwnership({
    headers: c.req.raw.headers,
    companyId,
    parseBody: parseZodBody(c, transferOwnershipBody, {
      transform: (d) => ({ toUserId: d.to_user_id }),
    }),
  });
  if (!guardResult.ok) return guardErrorResponse(guardResult);
  const { actor, toUserId } = guardResult;
  const actorUserId = actor.id;

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
