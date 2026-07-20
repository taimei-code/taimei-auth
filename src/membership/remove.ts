import { recordMembershipRemoved } from "@/db/repositories/audit-log";
import {
  deleteMembership,
  OwnerInvariantViolation,
  type Role,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { type DbTx, runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";

export type RemoveMemberResult =
  | { ok: true; accountDeleted: boolean }
  | { ok: false; reason: "last_owner" };

// ADR-0010 D2: メンバー除名 / 退会の mutation。membership を物理削除し、所属 0 件になった対象を
// 連動でアカウント削除する (orphan 不変条件)。OWNER を抜く場合は withOwnerLockGuard で「OWNER ≥ 1」を
// 守り、割る場合は orphan 削除ごと rollback する。認可 (誰が誰を抜けるか) は handler 側の責務。
// 設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
export const removeMember = (
  actorUserId: string,
  targetUserId: string,
  companyId: string,
  targetRole: Role,
): Promise<RemoveMemberResult> =>
  runInTransaction((tx) => {
    const apply = async (t: DbTx): Promise<{ ok: true; accountDeleted: boolean }> => {
      await deleteMembership(targetUserId, companyId, t);
      await recordMembershipRemoved(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          removed_user_id: targetUserId,
          role_at_removal: targetRole,
        },
        t,
      );
      return { ok: true, accountDeleted: await deleteAccountIfOrphaned(targetUserId, t) };
    };
    return targetRole === "OWNER" ? withOwnerLockGuard(tx, companyId, apply) : apply(tx);
  }).catch((e: unknown) => {
    if (e instanceof OwnerInvariantViolation) return { ok: false, reason: "last_owner" } as const;
    throw e;
  });
