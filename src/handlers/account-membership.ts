import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { switchCompany } from "../account/switch-company";
import { changeRole } from "../membership/change-role";
import {
  requireActor,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import { parseZodBody, roleBodySchema } from "./parse-body";
import { runRoute } from "./run-route";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z.object({ company_id: z.string().min(1).max(64) });
const updateRoleBody = z.object({ role: roleBodySchema });
const transferOwnershipBody = z.object({ to_user_id: z.string().min(1).max(64) });

// POST 事業所切替。target の active membership を switchCompany use-case が tx 内で再検証し
// last_used_company_id を更新する。TOCTOU / 短絡 / audit は use-case 側 (ADR-0012)。
accountMembership.post("/api/account/current-company", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const parsed = yield* parseZodBody(c, setCurrentCompanyBody, {
        transform: (d) => ({ targetCompanyId: d.company_id }),
      });
      const result = yield* switchCompany({
        actorUserId: actor.id,
        fromCompanyId: actor.lastUsedCompanyId,
        targetCompanyId: parsed.targetCompanyId,
      });
      return c.json({ ok: true, company_id: result.companyId });
    }),
  ),
);

// POST role 変更。OWNER≥1 保証 / no-op 短絡 / audit は changeRole use-case が持ち、
// 401→400→403→404→403 の判定順は entry (requireRoleChange) が担う。
accountMembership.post("/api/account/companies/:companyId/members/:targetUserId/role", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const targetUserId = c.req.param("targetUserId");
      const grant = yield* requireRoleChange({
        headers: c.req.raw.headers,
        companyId,
        targetUserId,
        parseBody: parseZodBody(c, updateRoleBody, { transform: (d) => ({ nextRole: d.role }) }),
      });
      yield* changeRole({
        actorUserId: grant.actor.id,
        targetUserId,
        companyId,
        beforeRole: grant.targetRole,
        nextRole: grant.nextRole,
      });
      return c.json({ ok: true });
    }),
  ),
);

// POST メンバー削除 (除名 / 退会)。認可順は entry (requireRemoval)、mutation (membership 削除 + 所属
// 0 件なら account 連動削除 + OWNER≥1 保証) は removeMember use-case が担う (ADR-0010 D2)。
accountMembership.post("/api/account/companies/:companyId/members/:targetUserId/remove", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const targetUserId = c.req.param("targetUserId");
      const { actor, targetRole } = yield* requireRemoval({
        headers: c.req.raw.headers,
        companyId,
        targetUserId,
      });
      const result = yield* removeMember({
        actorUserId: actor.id,
        targetUserId,
        companyId,
        targetRole,
      });
      // 本人が最後の所属を退会した場合 account_deleted=true。client はログアウト遷移する (UX は後続 PR)。
      return c.json({ ok: true, account_deleted: result.accountDeleted });
    }),
  ),
);

// POST オーナー委譲 (OWNER のみ)。target 昇格 + actor 降格を 1 tx で行い、「唯一の OWNER が抜けたい」
// 場合の先行導線になる (詳細: PR #55 → #63)。判定順は entry (requireTransferOwnership)。
accountMembership.post("/api/account/companies/:companyId/transfer-ownership", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const grant = yield* requireTransferOwnership({
        headers: c.req.raw.headers,
        companyId,
        parseBody: parseZodBody(c, transferOwnershipBody, {
          transform: (d) => ({ toUserId: d.to_user_id }),
        }),
      });
      yield* transferOwnership({
        actorUserId: grant.actor.id,
        toUserId: grant.toUserId,
        companyId,
      });
      return c.json({ ok: true });
    }),
  ),
);
