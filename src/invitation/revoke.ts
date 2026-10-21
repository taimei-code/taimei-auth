import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx, invitationRevokedEntry } from "../audit/append";
import type { VerifiedMember } from "../membership/guard";
import { Transaction } from "../transaction";
import { NotFoundOrNotPending } from "./errors";
import { InvitationRepo } from "./ports";

export const revokeInvitation = Effect.fnUntraced(function* (
  member: VerifiedMember<"ADMIN">,
  invitationId: string,
) {
  const actorUserId = member.actor.id;
  const { companyId } = member;
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
