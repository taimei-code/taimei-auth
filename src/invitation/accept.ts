import { Data, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import type { InviterSeen } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { appendAuditBestEffort, appendAuditInTx } from "../audit/append";
import { IdGenerator } from "../id-generator";
import { applyJoin } from "../membership/apply-change";
import { verifyInviter } from "../membership/policy";
import { ExpiredOrUsed } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { InvitationRepo } from "./ports";

const ACCEPT_REJECTED_LOG = "invitation_accept_rejected" as const;

class DoubleAccept extends Data.TaggedError("DoubleAccept") {
  readonly reason = "double_accept" as const;
  readonly inviter = null;
}

class InviterNotOwner extends Data.TaggedError("InviterNotOwner")<{
  readonly inviter: InviterSeen;
}> {
  readonly reason = "inviter_not_owner_or_missing" as const;
}

export const acceptInvitation = Effect.fnUntraced(function* (params: {
  actor: { id: string; email: string };
  invitation: InvitationRow;
}) {
  const { actor, invitation } = params;
  const invitations = yield* InvitationRepo;
  const memberships = yield* MembershipRepo;
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;

  const apply = Effect.fnUntraced(function* (t: DbTx) {
    const accepted = yield* invitations.markInvitationAccepted(invitation.id, t);
    if (!accepted) return yield* new DoubleAccept();

    if (invitation.role === "OWNER") {
      const verdict = yield* memberships
        .lockMembershipForShare(t, invitation.invitedByUserId, invitation.companyId)
        .pipe(Effect.map(verifyInviter));
      if (verdict._tag === "Reject") return yield* new InviterNotOwner({ inviter: verdict.seen });
    }

    yield* applyJoin(t, {
      id: ids.membershipId(),
      userId: actor.id,
      companyId: invitation.companyId,
      role: invitation.role,
    });
    yield* appendAuditInTx(t, {
      eventType: "invitation_accepted",
      userId: actor.id,
      payload: {
        invitation_id: invitation.id,
        company_id: invitation.companyId,
        accepted_by_user_id: actor.id,
        role: invitation.role,
      },
    });
  });

  yield* tx
    .run(apply)
    .pipe(
      Effect.catchTag(["DoubleAccept", "InviterNotOwner"], (rejected) =>
        recordRejectionAndFail(actor.id, invitation, rejected),
      ),
    );

  return { companyId: invitation.companyId };
});

const recordRejectionAndFail = Effect.fnUntraced(function* (
  actorUserId: string,
  invitation: InvitationRow,
  rejected: DoubleAccept | InviterNotOwner,
) {
  const payload = {
    invitation_id: invitation.id,
    company_id: invitation.companyId,
    invited_by_user_id: invitation.invitedByUserId,
    attempted_role: invitation.role,
    inviter: rejected.inviter,
    reason: rejected.reason,
  };
  yield* Effect.sync(() =>
    console.warn(ACCEPT_REJECTED_LOG, JSON.stringify({ actor_user_id: actorUserId, ...payload })),
  );
  yield* appendAuditBestEffort({
    eventType: ACCEPT_REJECTED_LOG,
    userId: actorUserId,
    payload,
  });
  return yield* new ExpiredOrUsed();
});
