import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { appendAuditInTx, membershipRemovedEntry } from "../audit/append";
import { Transaction } from "../transaction";
import { applyRemoval } from "./apply-change";
import type { RemovalGrant } from "./guard";

export const removeMember = Effect.fnUntraced(function* (grant: RemovalGrant) {
  const { targetUserId, companyId, targetRole } = grant;
  const actorUserId = grant.actor.id;
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
