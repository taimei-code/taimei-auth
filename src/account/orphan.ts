import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { MembershipRepo } from "../membership/ports";
import { deleteAccount } from "./delete-account";

export const deleteAccountIfOrphaned = Effect.fn("account.deleteAccountIfOrphaned")(function* (
  userId: string,
  tx: DbTx,
) {
  const memberships = yield* MembershipRepo;
  if ((yield* memberships.countActiveMembershipsByUserId(userId, tx)) > 0) return false;
  return yield* deleteAccount(userId, tx).pipe(
    Effect.as(true),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );
});
