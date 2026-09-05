import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { NotFoundOrNotPending } from "./errors";
import { InvitationRepo } from "./ports";

// ADR-0012 (Use-case 層): 招待取消手続。PENDING 行のみ REVOKED に落として audit を残す。
// markRevoked が 0 件更新なら NotFoundOrNotPending を E に載せ (tx ごと rollback)、audit は発火しない。
export const revokeInvitation = Effect.fn("invitation.revoke")(function* (params: {
  actorUserId: string;
  companyId: string;
  invitationId: string;
}) {
  const { actorUserId, companyId, invitationId } = params;
  const invitations = yield* InvitationRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fn("invitation.revoke.apply")(function* (t: DbTx) {
      const row = yield* invitations.markRevoked(invitationId, companyId, t);
      if (!row) return yield* new NotFoundOrNotPending();
      yield* audit.recordInvitationRevoked(
        { actor_user_id: actorUserId, invitation_id: row.id, company_id: companyId },
        t,
      );
    }),
  );
});
