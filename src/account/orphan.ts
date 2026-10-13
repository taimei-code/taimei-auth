import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { MembershipRepo } from "../membership/ports";
import { deleteAccount } from "./delete-account";
import type { AccountDeletionFlow } from "./delete-sessions";
import { UserRepo } from "./ports";

export const deleteAccountIfOrphaned = Effect.fnUntraced(function* (
  userId: string,
  tx: DbTx,
  flow: AccountDeletionFlow,
) {
  const memberships = yield* MembershipRepo;
  yield* UserRepo.use((users) => users.lockUsers(tx, [userId]));
  if ((yield* memberships.countActiveMembershipsByUserId(userId, tx)) > 0) return "kept" as const;
  return yield* deleteAccount(userId, tx, flow).pipe(
    Effect.as("deleted" as const),
    Effect.catchTag("NotFound", () => Effect.succeed("kept" as const)),
  );
});
