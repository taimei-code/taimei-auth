import { Effect } from "effect";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import type { DbError } from "../errors";
import { LastOwner } from "./errors";
import { orNotFound } from "../failures";
import { becomeCurrentOnJoin, reassignCurrentAfterLeaving } from "./current-company";
import { MembershipRepo } from "./ports";

type Write = (
  repo: MembershipRepo["Service"],
  tx: DbTx,
) => Effect.Effect<MembershipRow | undefined, DbError>;

const keepingAnOwner = Effect.fnUntraced(function* (
  tx: DbTx,
  companyId: string,
  ...writes: readonly [Write, ...Write[]]
) {
  const repo = yield* MembershipRepo;
  yield* repo.lockOwnerMembershipsOfCompany(tx, companyId);
  yield* Effect.forEach(writes, (write) => write(repo, tx).pipe(orNotFound), { discard: true });
  if ((yield* repo.countOwnerMemberships(tx, companyId)) < 1) return yield* new LastOwner();
});

export const applyRoleChange = (
  tx: DbTx,
  change: { targetUserId: string; companyId: string; nextRole: Role },
) =>
  keepingAnOwner(tx, change.companyId, (repo, t) =>
    repo.updateMembershipRole(change.targetUserId, change.companyId, change.nextRole, t),
  );

export const applyJoin = (
  tx: DbTx,
  row: { id: string; userId: string; companyId: string; role: Role },
) =>
  MembershipRepo.use((repo) =>
    repo
      .lockMembershipChangesOfUser(tx, row.userId)
      .pipe(Effect.andThen(repo.insertMembership(row, tx))),
  ).pipe(Effect.tap(() => becomeCurrentOnJoin(tx, row.userId, row.companyId)));

export const applyRemoval = (tx: DbTx, change: { targetUserId: string; companyId: string }) =>
  keepingAnOwner(tx, change.companyId, (repo, t) =>
    repo.deleteMembership(change.targetUserId, change.companyId, t),
  ).pipe(Effect.andThen(reassignCurrentAfterLeaving(tx, change.companyId, [change.targetUserId])));

export const applyCompanyRemoval = (tx: DbTx, companyId: string) =>
  MembershipRepo.use((repo) => repo.removeMembershipsOfCompany(companyId, tx)).pipe(
    Effect.tap((removed) =>
      reassignCurrentAfterLeaving(
        tx,
        companyId,
        removed.map((m) => m.userId),
      ),
    ),
  );

export const applyTransfer = (
  tx: DbTx,
  change: { actorUserId: string; toUserId: string; companyId: string },
) =>
  keepingAnOwner(
    tx,
    change.companyId,
    (repo, t) => repo.updateMembershipRole(change.toUserId, change.companyId, "OWNER", t),
    (repo, t) => repo.updateMembershipRole(change.actorUserId, change.companyId, "ADMIN", t),
  );
