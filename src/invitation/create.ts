import { recordInvitationSent } from "@/db/repositories/audit-log";
import {
  findActivePendingInvitation,
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  type InvitationRow,
  type Role,
} from "@/db/repositories/invitation";
import { runInTransaction } from "@/db/transaction";
import { tryConsumeInvitationQuota } from "./rate-limit";

// ADR-0012 (Use-case 層): 招待作成手続 (idempotency + rate-limit + INSERT + audit)。
// 手順は現行 handler と厳密に一致: idempotency 読取 (tx 外) → 新規のみ rate-limit 消費 (tx 外)
//   → tx 内で insertInvitation + recordInvitationSent。tx 内へ rate-limit を統合しない理由は、
// 並行重複招待時の Redis カウンタ消費パターンが変わって監視系が silent に drift するため。
// magic-link 送信は本 use-case が持たず handler が post-commit で行う (accept 側と対称)。
// 真並行 (両者が既存なしを観測) で rate 2 回消費 + PENDING 2 行 INSERT はあり得るのは
// 現行仕様 (PENDING に unique index なし)。冪等契約は逐次 semantic で担保する。
// 認可 (OWNER / ADMIN、canInviteRole) は Guard 層 (requireInvite) の責務。
// 設計詳細: docs/adr/0012-layered-architecture.md

const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // invitation は 24h 有効 (CONTEXT.md 'invitation')

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRow; reused: boolean }
  | { ok: false; reason: "rate_limited" };

export const createInvitation = async (params: {
  actorUserId: string;
  companyId: string;
  email: string;
  role: Role;
}): Promise<CreateInvitationResult> => {
  const { actorUserId, companyId, email, role } = params;

  const existing = await findActivePendingInvitation(companyId, email);
  if (existing) {
    return { ok: true, invitation: existing, reused: true };
  }

  const withinLimit = await tryConsumeInvitationQuota(companyId);
  if (!withinLimit) {
    return { ok: false, reason: "rate_limited" };
  }

  const row = await runInTransaction(async (tx) => {
    const inserted = await insertInvitation(
      {
        id: generateInvitationId(),
        companyId,
        email,
        role,
        token: generateInvitationToken(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedByUserId: actorUserId,
      },
      tx,
    );
    await recordInvitationSent(
      {
        actor_user_id: actorUserId,
        invitation_id: inserted.id,
        company_id: companyId,
        invited_email: email,
        role,
      },
      tx,
    );
    return inserted;
  });

  return { ok: true, invitation: row, reused: false };
};
