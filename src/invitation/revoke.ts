import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx, invitationRevokedEntry } from "../audit/append";
import { Transaction } from "../transaction";
import { NotFoundOrNotPending } from "./errors";
import { InvitationRepo } from "./ports";

export const revokeInvitation = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  companyId: string;
  invitationId: string;
}) {
  const { actorUserId, companyId, invitationId } = params;
  const invitations = yield* InvitationRepo;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      const row = yield* invitations.markInvitationRevoked(invitationId, companyId, t);
      if (!row) return yield* new NotFoundOrNotPending();
      yield* appendAuditInTx(
        t,
        invitationRevokedEntry(actorUserId, { invitationId: row.id, companyId }),
      );
    }),
  );
});
