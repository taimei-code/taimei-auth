import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx } from "../audit/append";
import { Transaction } from "../transaction";
import { applyRoleChange } from "./apply-change";

export const changeRole = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  beforeRole: Role;
  nextRole: Role;
}) {
  const { actorUserId, targetUserId, companyId, beforeRole, nextRole } = params;

  if (beforeRole === nextRole) return;

  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* applyRoleChange(t, { targetUserId, companyId, nextRole });
      yield* appendAuditInTx(t, {
        eventType: "role_changed",
        userId: actorUserId,
        payload: {
          company_id: companyId,
          target_user_id: targetUserId,
          before_role: beforeRole,
          after_role: nextRole,
          changed_by_user_id: actorUserId,
        },
      });
    }),
  );
});
