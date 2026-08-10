import { Hono } from "hono";
import { z } from "zod";

import { switchCompany } from "../account/switch-company";
import {
  guardErrorResponse,
  reasonToGuardError,
  requireActor,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { changeRole } from "../membership/change-role";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import { parseZodBody, roleBodySchema } from "./parse-body";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z.object({ company_id: z.string().min(1).max(64) });
const updateRoleBody = z.object({ role: roleBodySchema });
const transferOwnershipBody = z.object({ to_user_id: z.string().min(1).max(64) });

// POST 事業所切替。target の active membership を持つことを switchCompany use-case が tx 内で再検証し
// user.last_used_company_id (SDK companyId source) を更新する。TOCTOU / same-company 短絡 / audit の
// 詳細は use-case 側 (src/account/switch-company.ts) と ADR-0012 参照。
accountMembership.post("/api/account/current-company", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const parsed = await parseZodBody(c, setCurrentCompanyBody, {
    transform: (d) => ({ targetCompanyId: d.company_id }),
  })();
  if (!parsed.ok) {
    return guardErrorResponse({ ok: false, error: "invalid_argument", status: 400 });
  }

  const result = await switchCompany({
    actorUserId: actorResult.actor.id,
    fromCompanyId: actorResult.actor.lastUsedCompanyId,
    targetCompanyId: parsed.data.targetCompanyId,
  });
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  return c.json({ ok: true, company_id: result.companyId });
});

// POST role 変更。role 階層: OWNER は全 role 設定可、ADMIN は MEMBER↔ADMIN のみ (OWNER 昇格 / OWNER 操作は不可)。
// OWNER を降格する変更の OWNER≥1 保証 / no-op 短絡 / audit は changeRole use-case が持つ。
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
        transform: (d) => ({ nextRole: d.role }),
      }),
    });
    if (!guardResult.ok) return guardErrorResponse(guardResult);

    const result = await changeRole({
      actorUserId: guardResult.actor.id,
      targetUserId,
      companyId,
      beforeRole: guardResult.targetRole,
      nextRole: guardResult.nextRole,
    });
    if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
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
    if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
    // 本人が最後の所属を退会した場合 account_deleted=true。client はログアウト遷移する (UX は後続 PR)。
    return c.json({ ok: true, account_deleted: result.accountDeleted });
  },
);

// POST オーナー委譲 (OWNER のみ)。target を OWNER 昇格 + actor を ADMIN 降格を 1 transaction で。
// 「唯一の OWNER が抜けたい」場合に先に委譲してから退会する導線 (詳細: PR #55 → #63)。use-case (transferOwnership) が
// withOwnerLockGuard 内で mutation + audit を所有する。
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

  const result = await transferOwnership({
    actorUserId: guardResult.actor.id,
    toUserId: guardResult.toUserId,
    companyId,
  });
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  return c.json({ ok: true });
});
