import { recordOwnershipTransferred } from "@/db/repositories/audit-log";
import {
  OwnerInvariantViolation,
  updateMembershipRole,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): オーナー委譲手続。target を OWNER 昇格 + actor を ADMIN 降格を単一 tx で。
// withOwnerLockGuard の FOR UPDATE 直列化により、二段委譲 (A→B 後 B→C) は両者 200、
// A→B 完了後の A→C 再送は Guard 側の OWNER 判定 (A は既に ADMIN) で 403 (現行挙動維持)。
// actor は委譲中 OWNER のままなので OWNER≥1 は理論上壊れないが、並行操作との合流点で
// 万一 lock guard 内 count が < 1 になったら Result で last_owner を返す。
// 認可 (OWNER のみ) / self-transfer 拒否 / not_found / already_owner は Guard 層の責務。
// 設計詳細: docs/adr/0012-layered-architecture.md

export type TransferOwnershipResult = { ok: true } | { ok: false; reason: "last_owner" };

export const transferOwnership = (params: {
  actorUserId: string;
  toUserId: string;
  companyId: string;
}): Promise<TransferOwnershipResult> => {
  const { actorUserId, toUserId, companyId } = params;
  return runInTransaction((tx) =>
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
  )
    .then((): TransferOwnershipResult => ({ ok: true }))
    .catch((e: unknown) => {
      if (e instanceof OwnerInvariantViolation) return { ok: false, reason: "last_owner" } as const;
      throw e;
    });
};
