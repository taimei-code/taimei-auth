import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx } from "../audit/append";
import { Transaction } from "../transaction";
import { applyTransfer } from "./apply-change";
import type { OwnershipTransferGrant } from "./guard";

export const transferOwnership = Effect.fnUntraced(function* (grant: OwnershipTransferGrant) {
  const { toUserId, companyId } = grant;
  const actorUserId = grant.actor.id;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* applyTransfer(t, { actorUserId, toUserId, companyId });
      yield* appendAuditInTx(t, {
        eventType: "ownership_transferred",
        userId: actorUserId,
        payload: { company_id: companyId, from_user_id: actorUserId, to_user_id: toUserId },
      });
    }),
  );
});
