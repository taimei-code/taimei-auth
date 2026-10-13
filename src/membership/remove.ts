import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { appendAuditInTx, membershipRemovedEntry } from "../audit/append";
import { Transaction } from "../transaction";
import { applyRemoval } from "./apply-change";

export const removeMember = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  targetRole: Role;
}) {
  const { actorUserId, targetUserId, companyId, targetRole } = params;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* applyRemoval(t, { targetUserId, companyId });
      yield* appendAuditInTx(
        t,
        membershipRemovedEntry(actorUserId, { companyId, userId: targetUserId, role: targetRole }),
      );
      const removal = yield* deleteAccountIfOrphaned(targetUserId, t, "member-remove");
      return { accountDeleted: removal === "deleted" };
    }),
  );
});
