import { recordRoleChanged } from "@/db/repositories/audit-log";
import {
  catchOwnerInvariant,
  type Role,
  updateMembershipRole,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { type DbTx, runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): membership.role の変更手続。tx / audit / OWNER≥1 保証と no-op 短絡を所有する。
// OWNER→非 OWNER の降格のみ withOwnerLockGuard で守り、割ると Result で last_owner を返す。

export type ChangeRoleResult = { ok: true } | { ok: false; reason: "last_owner" | "not_found" };

export const changeRole = (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  beforeRole: Role;
  nextRole: Role;
}): Promise<ChangeRoleResult> => {
  const { actorUserId, targetUserId, companyId, beforeRole, nextRole } = params;

  // no-op 短絡: beforeRole と一致するなら tx open / audit を発火しない (tx 数 metric の silent 増を防ぐ)。
  if (beforeRole === nextRole) {
    return Promise.resolve({ ok: true });
  }

  const apply = async (tx: DbTx): Promise<ChangeRoleResult> => {
    const updated = await updateMembershipRole(targetUserId, companyId, nextRole, tx);
    if (!updated) return { ok: false, reason: "not_found" };
    await recordRoleChanged(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        target_user_id: targetUserId,
        before_role: beforeRole,
        after_role: nextRole,
      },
      tx,
    );
    return { ok: true };
  };

  const demotesOwner = beforeRole === "OWNER" && nextRole !== "OWNER";
  return catchOwnerInvariant(
    runInTransaction((tx) => (demotesOwner ? withOwnerLockGuard(tx, companyId, apply) : apply(tx))),
  );
};
