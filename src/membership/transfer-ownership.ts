import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { applyTransfer } from "./apply-change";

export const transferOwnership = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  toUserId: string;
  companyId: string;
}) {
  const { actorUserId, toUserId, companyId } = params;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* applyTransfer(t, { actorUserId, toUserId, companyId });
      yield* audit.recordOwnershipTransferred(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          from_user_id: actorUserId,
          to_user_id: toUserId,
        },
        t,
      );
    }),
  );
});
