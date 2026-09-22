import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { UserRepo } from "./ports";
import { revokeUserSessions } from "./revoke-sessions";

// audit を tx の先頭に置くのは、tx が失敗したときに audit の行だけが残らないようにするため (audit_log.user_id には FK が無い)。
export const deleteAccount = Effect.fn("account.deleteAccount")(function* (
  userId: string,
  tx: DbTx,
) {
  const audit = yield* AuditLog;
  const users = yield* UserRepo;
  yield* audit.recordAccountDeleted({ user_id: userId }, tx);
  yield* revokeUserSessions(userId, tx);
  return yield* users.deleteUser(userId, tx);
});
