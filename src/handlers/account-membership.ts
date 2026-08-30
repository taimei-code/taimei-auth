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

// POST 事業所切替。target の active membership を switchCompany use-case が tx 内で再検証し
// last_used_company_id を更新する。TOCTOU / 短絡 / audit は use-case 側 (ADR-0012)。
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

// POST role 変更。OWNER≥1 保証 / no-op 短絡 / audit は changeRole use-case が持ち、
// 401→400→403→404→403 の判定順は entry (requireRoleChange) が担う。
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

// POST メンバー削除 (除名 / 退会)。認可順は entry (requireRemoval)、mutation (membership 削除 + 所属
// 0 件なら account 連動削除 + OWNER≥1 保証) は removeMember use-case が担う (ADR-0010 D2)。
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

// POST オーナー委譲 (OWNER のみ)。target 昇格 + actor 降格を 1 tx で行い、「唯一の OWNER が抜けたい」
// 場合の先行導線になる (詳細: PR #55 → #63)。判定順は entry (requireTransferOwnership)。
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
