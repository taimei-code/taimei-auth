import { Effect } from "effect";
import type { MembershipRow, Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import type { DbError } from "../errors";
import { LastOwner } from "./errors";
import { orNotFound } from "./guard/errors";
import { MembershipRepo } from "./ports";

type Write = (
  repo: MembershipRepo["Service"],
  tx: DbTx,
) => Effect.Effect<MembershipRow | undefined, DbError>;

const keepingAnOwner = Effect.fn("membership.keepingAnOwner")(function* (
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

export const applyRemoval = (tx: DbTx, change: { targetUserId: string; companyId: string }) =>
  keepingAnOwner(tx, change.companyId, (repo, t) =>
    repo.deleteMembership(change.targetUserId, change.companyId, t),
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
