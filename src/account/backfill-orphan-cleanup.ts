import { revokePendingInvitationsOfCompany } from "@/db/repositories/invitation";
import {
  countActiveMembershipsByUserId,
  findDeletedCompanyIdsWithMemberships,
  findMembersByCompanyId,
  removeMembershipsOfCompany,
} from "@/db/repositories/membership";
import { reassignLastUsedCompanyForDeletedCompany } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "./orphan";

export type BackfillReport = {
  executed: boolean;
  companyCount: number;
  membershipsRemoved: number;
  accountsDeleted: number;
  deletedUserIds: string[];
};

// ADR-0010 PR-4: D1 (事業所削除で membership 物理削除) 導入前に soft delete された company に残る
// ghost membership と、それにより放置された orphan アカウントを掃除する one-shot backfill。
// rollback 不能な物理削除を初回適用するため、execute=false の dry-run で対象 (件数 + 削除予定 user_id) を
// 確認してから execute=true で実行する運用。設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
export async function backfillOrphanCleanup(opts: { execute: boolean }): Promise<BackfillReport> {
  const companyIds = await findDeletedCompanyIdsWithMemberships();
  const deletedUserIds = new Set<string>();
  let membershipsRemoved = 0;

  for (const companyId of companyIds) {
    if (!opts.execute) {
      // dry-run: mutate せず「物理削除される membership 数」と「orphan として消える user」を集計する。
      const members = await findMembersByCompanyId(companyId);
      membershipsRemoved += members.length;
      for (const m of members) {
        if ((await countActiveMembershipsByUserId(m.userId)) === 0) deletedUserIds.add(m.userId);
      }
      continue;
    }
    // 実削除は company 単位の tx で。DeleteCompany と同じく invitation 失効 → membership 物理削除 →
    // last_used 付け替え → orphan 削除 の順 (company は既に soft delete 済みなので触らない)。
    await runInTransaction(async (tx) => {
      await revokePendingInvitationsOfCompany(companyId, tx);
      const removed = await removeMembershipsOfCompany(companyId, tx);
      membershipsRemoved += removed.length;
      await reassignLastUsedCompanyForDeletedCompany(companyId, tx);
      for (const userId of new Set(removed.map((m) => m.userId))) {
        if (await deleteAccountIfOrphaned(userId, tx)) deletedUserIds.add(userId);
      }
    });
  }

  return {
    executed: opts.execute,
    companyCount: companyIds.length,
    membershipsRemoved,
    accountsDeleted: deletedUserIds.size,
    deletedUserIds: [...deletedUserIds],
  };
}
