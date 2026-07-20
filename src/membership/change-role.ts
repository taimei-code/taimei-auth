import { recordRoleChanged } from "@/db/repositories/audit-log";
import {
  OwnerInvariantViolation,
  type Role,
  updateMembershipRole,
  withOwnerLockGuard,
} from "@/db/repositories/membership";
import { type DbTx, runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): membership.role の変更手続 1 業務単位。
// tx / audit / OWNER≥1 保証を所有し、Transport (handler) は Guard 通過後の値を渡すだけ。
// beforeRole === nextRole の 200 短絡は handler ではなく本 use-case が担当する
// (tx / audit を発火しない no-op 経路を 1 箇所に閉じる)。
// OWNER→非 OWNER の降格のみ withOwnerLockGuard で「OWNER ≥ 1」を守り、割ると Result で
// last_owner を返す。認可 (誰が誰の role を変えられるか) は Guard 層 (requireRoleChange) の責務。
// 設計詳細: docs/adr/0012-layered-architecture.md

export type ChangeRoleResult = { ok: true } | { ok: false; reason: "last_owner" | "not_found" };

export const changeRole = (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  beforeRole: Role;
  nextRole: Role;
}): Promise<ChangeRoleResult> => {
  const { actorUserId, targetUserId, companyId, beforeRole, nextRole } = params;

  // no-op 短絡: guard で確認済みの beforeRole と一致するなら tx open / audit 発火なし。
  // 「tx 数 metric が silent に増える」regression を防ぐため use-case 層で吸収する。
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
  return runInTransaction((tx) =>
    demotesOwner ? withOwnerLockGuard(tx, companyId, apply) : apply(tx),
  ).catch((e: unknown) => {
    if (e instanceof OwnerInvariantViolation) return { ok: false, reason: "last_owner" } as const;
    throw e;
  });
};
