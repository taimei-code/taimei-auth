import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { AuthApi } from "../auth-service";
import { LastOwner } from "../membership/errors";
import { orNotFound } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { captureCause } from "../sentry";
import { Transaction } from "../transaction";
import { UserRepo } from "./ports";

export const deleteAccount = Effect.fn("account.deleteAccount")(function* (
  userId: string,
  tx: DbTx,
) {
  const audit = yield* AuditLog;
  const users = yield* UserRepo;
  yield* users.deleteUser(userId, tx).pipe(orNotFound);
  yield* audit.recordAccountDeleted({ user_id: userId }, tx);
});

export const deleteAccountUnlessLastOwner = Effect.fn("account.deleteAccountUnlessLastOwner")(
  function* (userId: string) {
    const memberships = yield* MembershipRepo;
    const tx = yield* Transaction;
    yield* tx.run(
      Effect.fn("account.deleteAccountUnlessLastOwner.apply")(function* (t: DbTx) {
        yield* memberships.lockOwnerMembershipsOfUserCompanies(t, userId);
        yield* memberships.lockMembershipChangesOfUser(t, userId);
        if ((yield* memberships.findCompaniesBlockingUserDeletion(userId, t)).length > 0)
          return yield* new LastOwner();
        yield* deleteAccount(userId, t);
      }),
    );
    yield* AuthApi.use((authApi) => authApi.deleteUserSessions(userId)).pipe(
      Effect.catchTag("AuthApiError", captureCause({ tags: { component: "deleteAccount" } })),
    );
  },
);
