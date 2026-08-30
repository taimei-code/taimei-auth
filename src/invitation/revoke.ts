import { recordInvitationRevoked } from "@/db/repositories/audit-log";
import { markInvitationRevoked } from "@/db/repositories/invitation";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): 招待取消手続。PENDING 行のみ REVOKED に落として audit を残す。
// markInvitationRevoked が 0 件更新なら not_found_or_not_pending を返し audit は発火しない。

export type RevokeInvitationResult =
  | { ok: true }
  | { ok: false; reason: "not_found_or_not_pending" };

export const revokeInvitation = (params: {
  actorUserId: string;
  companyId: string;
  invitationId: string;
}): Promise<RevokeInvitationResult> => {
  const { actorUserId, companyId, invitationId } = params;
  return runInTransaction(async (tx): Promise<RevokeInvitationResult> => {
    const row = await markInvitationRevoked(invitationId, companyId, tx);
    if (!row) return { ok: false, reason: "not_found_or_not_pending" };
    await recordInvitationRevoked(
      { actor_user_id: actorUserId, invitation_id: row.id, company_id: companyId },
      tx,
    );
    return { ok: true };
  });
};
