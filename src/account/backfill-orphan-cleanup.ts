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

type GhostMembershipPurge = { ghostMembershipCount: number; orphanUserIds: string[] };

// ADR-0010 PR-4: D1 導入前に soft delete された company に残る ghost membership と orphan アカウントを
// 掃除する one-shot backfill。rollback 不能なため dry-run で対象を確認してから execute=true で実行する。
export async function backfillOrphanCleanup(opts: { execute: boolean }): Promise<BackfillReport> {
  const companyIds = await findDeletedCompanyIdsWithMemberships();
  const deletedUserIds = new Set<string>();
  let membershipsRemoved = 0;

  for (const companyId of companyIds) {
    const purge = opts.execute
      ? await purgeGhostMemberships(companyId)
      : await previewGhostMembershipPurge(companyId);
    membershipsRemoved += purge.ghostMembershipCount;
    for (const userId of purge.orphanUserIds) deletedUserIds.add(userId);
  }

  return {
    executed: opts.execute,
    companyCount: companyIds.length,
    membershipsRemoved,
    accountsDeleted: deletedUserIds.size,
    deletedUserIds: [...deletedUserIds],
  };
}

async function previewGhostMembershipPurge(companyId: string): Promise<GhostMembershipPurge> {
  const members = await findMembersByCompanyId(companyId);
  const orphanUserIds: string[] = [];
  for (const m of members) {
    if ((await countActiveMembershipsByUserId(m.userId)) === 0) orphanUserIds.push(m.userId);
  }
  return { ghostMembershipCount: members.length, orphanUserIds };
}

// DeleteCompany と同じ順 (invitation 失効 → membership 削除 → last_used 付け替え → orphan 削除) を守る。
async function purgeGhostMemberships(companyId: string): Promise<GhostMembershipPurge> {
  return runInTransaction(async (tx) => {
    await revokePendingInvitationsOfCompany(companyId, tx);
    const removed = await removeMembershipsOfCompany(companyId, tx);
    await reassignLastUsedCompanyForDeletedCompany(companyId, tx);
    const orphanUserIds: string[] = [];
    for (const userId of new Set(removed.map((m) => m.userId))) {
      if (await deleteAccountIfOrphaned(userId, tx)) orphanUserIds.push(userId);
    }
    return { ghostMembershipCount: removed.length, orphanUserIds };
  });
}
