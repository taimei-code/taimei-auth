import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx } from "../audit/append";
import { LastOwner } from "../membership/errors";
import { orNotFound } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { afterCommit, Transaction } from "../transaction";
import { type AccountDeletionFlow, deleteSessionsOf } from "./delete-sessions";
import { UserRepo } from "./ports";

export const deleteAccount = Effect.fnUntraced(function* (
  userId: string,
  tx: DbTx,
  flow: AccountDeletionFlow,
) {
  const users = yield* UserRepo;
  yield* users.deleteUser(userId, tx).pipe(orNotFound);
  yield* appendAuditInTx(tx, { eventType: "account_delete", userId, payload: {} });
  yield* afterCommit(deleteSessionsOf(userId, flow));
});

export const deleteAccountUnlessLastOwner = Effect.fnUntraced(function* (userId: string) {
  const memberships = yield* MembershipRepo;
  const tx = yield* Transaction;
  yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* memberships.lockOwnerMembershipsOfUserCompanies(t, userId);
      yield* memberships.lockMembershipChangesOfUser(t, userId);
      if ((yield* memberships.findCompaniesBlockingUserDeletion(userId, t)).length > 0)
        return yield* new LastOwner();
      yield* deleteAccount(userId, t, "account-delete");
    }),
  );
});
