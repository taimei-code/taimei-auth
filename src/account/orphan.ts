import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { MembershipRepo } from "../membership/ports";
import { deleteAccount } from "./delete-account";
import { UserRepo } from "./ports";

export const deleteAccountIfOrphaned = Effect.fnUntraced(function* (userId: string, tx: DbTx) {
  const memberships = yield* MembershipRepo;
  yield* UserRepo.use((users) => users.lockUsers(tx, [userId]));
  if ((yield* memberships.countActiveMembershipsByUserId(userId, tx)) > 0) return false;
  return yield* deleteAccount(userId, tx).pipe(
    Effect.as(true),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );
});
