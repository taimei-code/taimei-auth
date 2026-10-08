import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { deleteSessionsOf } from "../account/delete-sessions";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { applyRemoval } from "./apply-change";

export const removeMember = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  targetRole: Role;
}) {
  const { actorUserId, targetUserId, companyId, targetRole } = params;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  const result = yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* applyRemoval(t, { targetUserId, companyId });
      yield* audit.recordMembershipRemoved(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          removed_user_id: targetUserId,
          role_at_removal: targetRole,
        },
        t,
      );
      return { accountDeleted: yield* deleteAccountIfOrphaned(targetUserId, t) };
    }),
  );
  if (result.accountDeleted) yield* deleteSessionsOf([targetUserId], "member-remove");
  return result;
});
