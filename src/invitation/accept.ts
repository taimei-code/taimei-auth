import { Data, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import type { InviterSeen } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { swallowAuditFailure } from "../audit/report-failure";
import { IdGenerator } from "../id-generator";
import { verifyInviter } from "../membership/policy";
import { ExpiredOrUsed } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { InvitationRepo } from "./ports";

// 招待者の再検証を tx 内に置くのは、降格の UPDATE が割り込む TOCTOU の隙間を無くすため。

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

export const acceptInvitation = Effect.fn("invitation.accept")(function* (params: {
  actor: { id: string; email: string };
  invitation: InvitationRow;
}) {
  const { actor, invitation } = params;
  const invitations = yield* InvitationRepo;
  const memberships = yield* MembershipRepo;
  const audit = yield* AuditLog;
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;

  const apply = Effect.fn("invitation.accept.apply")(function* (t: DbTx) {
    const accepted = yield* invitations.markInvitationAccepted(invitation.id, t);
    if (!accepted) return yield* new DoubleAccept();

    if (invitation.role === "OWNER") {
      const verdict = yield* memberships
        .lockMembershipForShare(t, invitation.invitedByUserId, invitation.companyId)
        .pipe(Effect.map(verifyInviter));
      if (verdict._tag === "Reject") return yield* new InviterNotOwner({ inviter: verdict.seen });
    }

    yield* memberships.insertMembership(
      {
        id: ids.membershipId(),
        userId: actor.id,
        companyId: invitation.companyId,
        role: invitation.role,
      },
      t,
    );
    yield* audit.recordInvitationAccepted(
      {
        actor_user_id: actor.id,
        invitation_id: invitation.id,
        company_id: invitation.companyId,
        role: invitation.role,
      },
      t,
    );
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

const recordRejectionAndFail = Effect.fn("invitation.accept.recordRejection")(function* (
  actorUserId: string,
  invitation: InvitationRow,
  rejected: DoubleAccept | InviterNotOwner,
) {
  const audit = yield* AuditLog;
  const payload = {
    actor_user_id: actorUserId,
    invitation_id: invitation.id,
    company_id: invitation.companyId,
    invited_by_user_id: invitation.invitedByUserId,
    attempted_role: invitation.role,
    inviter: rejected.inviter,
    reason: rejected.reason,
  };
  // console.warn を DB 書き込みの前に置くのは、DB に接続できなくても痕跡を残すため。この行の形式は運用の log filter が前提にしている。
  yield* Effect.sync(() => console.warn(ACCEPT_REJECTED_LOG, JSON.stringify(payload)));
  yield* audit
    .recordInvitationAcceptRejected(payload)
    .pipe(swallowAuditFailure(ACCEPT_REJECTED_LOG));
  return yield* new ExpiredOrUsed();
});
