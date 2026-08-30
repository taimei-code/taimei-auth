import { recordMembershipRemoved } from "@/db/repositories/audit-log";
import {
  catchOwnerInvariant,
  deleteMembership,
  type Role,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { type DbTx, runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";

export type RemoveMemberResult =
  | { ok: true; accountDeleted: boolean }
  | { ok: false; reason: "last_owner" };

// ADR-0010 D2: 除名 / 退会の mutation。membership を物理削除し所属 0 件になった対象を連動削除する。
// OWNER を抜く場合は withOwnerLockGuard で「OWNER ≥ 1」を守り、割る場合は orphan 削除ごと rollback する。
export const removeMember = (
  actorUserId: string,
  targetUserId: string,
  companyId: string,
  targetRole: Role,
): Promise<RemoveMemberResult> =>
  catchOwnerInvariant(
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
    }),
  );
