import { Effect } from "effect";
import { InvitationRepo } from "../invitation/ports";
import { applyCompanyRemoval } from "../membership/apply-change";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { deleteAccountIfOrphaned } from "./orphan";

type BackfillReport = {
  executed: boolean;
  companyCount: number;
  membershipsRemoved: number;
  accountsDeleted: number;
  deletedUserIds: string[];
};

type GhostMembershipPurge = { ghostMembershipCount: number; orphanUserIds: string[] };

export const backfillOrphanCleanup = Effect.fn("account.backfillOrphanCleanup")(function* (opts: {
  execute: boolean;
}) {
  const companyIds = yield* MembershipRepo.use((memberships) =>
    memberships.findDeletedCompanyIdsWithMemberships(),
  );
  const purges = yield* Effect.forEach(companyIds, (companyId) =>
    opts.execute ? purgeGhostMemberships(companyId) : previewGhostMembershipPurge(companyId),
  );
  const deletedUserIds = [...new Set(purges.flatMap((purge) => purge.orphanUserIds))];

  return {
    executed: opts.execute,
    companyCount: companyIds.length,
    membershipsRemoved: purges.reduce((n, purge) => n + purge.ghostMembershipCount, 0),
    accountsDeleted: deletedUserIds.length,
    deletedUserIds,
  } satisfies BackfillReport;
});

const previewGhostMembershipPurge = Effect.fn("account.previewGhostMembershipPurge")(function* (
  companyId: string,
) {
  const memberships = yield* MembershipRepo;
  const members = yield* memberships.findMembersByCompanyId(companyId);
  const orphans = yield* Effect.filter(members, (m) =>
    Effect.map(memberships.countActiveMembershipsByUserId(m.userId), (n) => n === 0),
  );
  return {
    ghostMembershipCount: members.length,
    orphanUserIds: orphans.map((m) => m.userId),
  } satisfies GhostMembershipPurge;
});

const purgeGhostMemberships = Effect.fn("account.purgeGhostMemberships")(function* (
  companyId: string,
) {
  const invitations = yield* InvitationRepo;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("account.purgeGhostMemberships.apply")(function* (t) {
      yield* invitations.revokePendingInvitationsOfCompany(companyId, t);
      const removed = yield* applyCompanyRemoval(t, companyId);
      const orphanUserIds = yield* Effect.filter(
        [...new Set(removed.map((m) => m.userId))],
        (userId) => deleteAccountIfOrphaned(userId, t),
      );
      return { ghostMembershipCount: removed.length, orphanUserIds } satisfies GhostMembershipPurge;
    }),
  );
});
