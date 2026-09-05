import { Effect } from "effect";
import { InvitationRepo } from "../invitation/ports";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { deleteAccountIfOrphaned } from "./orphan";
import { UserRepo } from "./ports";

type BackfillReport = {
  executed: boolean;
  companyCount: number;
  membershipsRemoved: number;
  accountsDeleted: number;
  deletedUserIds: string[];
};

type GhostMembershipPurge = { ghostMembershipCount: number; orphanUserIds: string[] };

// ADR-0010 PR-4: D1 導入前に soft delete された company に残る ghost membership と orphan アカウントを
// 掃除する one-shot backfill。rollback 不能なため dry-run で対象を確認してから execute=true で実行する。
export const backfillOrphanCleanup = Effect.fn("account.backfillOrphanCleanup")(function* (opts: {
  execute: boolean;
}) {
  const memberships = yield* MembershipRepo;
  const companyIds = yield* memberships.findDeletedCompanyIdsWithMemberships();
  const deletedUserIds = new Set<string>();
  let membershipsRemoved = 0;

  for (const companyId of companyIds) {
    const purge = yield* opts.execute
      ? purgeGhostMemberships(companyId)
      : previewGhostMembershipPurge(companyId);
    membershipsRemoved += purge.ghostMembershipCount;
    for (const userId of purge.orphanUserIds) deletedUserIds.add(userId);
  }

  return {
    executed: opts.execute,
    companyCount: companyIds.length,
    membershipsRemoved,
    accountsDeleted: deletedUserIds.size,
    deletedUserIds: [...deletedUserIds],
  } satisfies BackfillReport;
});

const previewGhostMembershipPurge = Effect.fn("account.previewGhostMembershipPurge")(function* (
  companyId: string,
) {
  const memberships = yield* MembershipRepo;
  const members = yield* memberships.findMembersByCompanyId(companyId);
  const orphanUserIds: string[] = [];
  for (const m of members) {
    if ((yield* memberships.countActiveMembershipsByUserId(m.userId)) === 0) {
      orphanUserIds.push(m.userId);
    }
  }
  return { ghostMembershipCount: members.length, orphanUserIds } satisfies GhostMembershipPurge;
});

// DeleteCompany と同じ順 (invitation 失効 → membership 削除 → last_used 付け替え → orphan 削除) を守る。
const purgeGhostMemberships = Effect.fn("account.purgeGhostMemberships")(function* (
  companyId: string,
) {
  const memberships = yield* MembershipRepo;
  const invitations = yield* InvitationRepo;
  const users = yield* UserRepo;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("account.purgeGhostMemberships.apply")(function* (t) {
      yield* invitations.revokePendingOfCompany(companyId, t);
      const removed = yield* memberships.removeMembershipsOfCompany(companyId, t);
      yield* users.reassignLastUsedCompanyForDeletedCompany(companyId, t);
      const orphanUserIds: string[] = [];
      for (const userId of new Set(removed.map((m) => m.userId))) {
        if (yield* deleteAccountIfOrphaned(userId, t)) orphanUserIds.push(userId);
      }
      return { ghostMembershipCount: removed.length, orphanUserIds } satisfies GhostMembershipPurge;
    }),
  );
});
