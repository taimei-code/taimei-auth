import { recordOwnershipTransferred } from "@/db/repositories/audit-log";
import {
  catchOwnerInvariant,
  updateMembershipRole,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): オーナー委譲手続。target 昇格 + actor 降格を単一 tx で行い、withOwnerLockGuard の
// FOR UPDATE 直列化で並行委譲を捌く。lock guard 内 count が < 1 になったら Result で last_owner を返す。

export type TransferOwnershipResult = { ok: true } | { ok: false; reason: "last_owner" };

export const transferOwnership = (params: {
  actorUserId: string;
  toUserId: string;
  companyId: string;
}): Promise<TransferOwnershipResult> => {
  const { actorUserId, toUserId, companyId } = params;
  return catchOwnerInvariant(
    runInTransaction((tx) =>
      withOwnerLockGuard(tx, companyId, async (ownerLockedTx) => {
        await updateMembershipRole(toUserId, companyId, "OWNER", ownerLockedTx);
        await updateMembershipRole(actorUserId, companyId, "ADMIN", ownerLockedTx);
        await recordOwnershipTransferred(
          {
            actor_user_id: actorUserId,
            company_id: companyId,
            from_user_id: actorUserId,
            to_user_id: toUserId,
          },
          ownerLockedTx,
        );
      }),
    ).then((): TransferOwnershipResult => ({ ok: true })),
  );
};
