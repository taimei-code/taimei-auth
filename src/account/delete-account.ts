import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { orNotFound } from "../membership/guard/errors";
import { UserRepo } from "./ports";
import { revokeUserSessions } from "./revoke-sessions";

export const deleteAccount = Effect.fn("account.deleteAccount")(function* (
  userId: string,
  tx: DbTx,
) {
  const audit = yield* AuditLog;
  const users = yield* UserRepo;
  yield* users.deleteUser(userId, tx).pipe(orNotFound);
  yield* audit.recordAccountDeleted({ user_id: userId }, tx);
  yield* revokeUserSessions(userId, tx);
});
