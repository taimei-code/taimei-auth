import { Data, Effect } from "effect";
import type { InvitationRow, Role } from "@/db/repositories/invitation";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { swallowAuditFailure } from "../audit/report-failure";
import { IdGenerator } from "../id-generator";
import { canAcceptInvitedRole } from "../membership/policy";
import { ExpiredOrUsed } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import type { RejectReason } from "./errors";
import { InvitationRepo } from "./ports";

// 招待者の再検証を tx 内に置くのは、降格 UPDATE が割り込む TOCTOU 窓を閉じるため。

const ACCEPT_REJECTED_LOG = "invitation_accept_rejected" as const;

class RejectAccept extends Data.TaggedError("RejectAccept")<{
  readonly reason: RejectReason;
  readonly inviterRole: Role | null;
}> {}

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
    if (!accepted) return yield* new RejectAccept({ reason: "double_accept", inviterRole: null });

    const inviterCurrentRole =
      invitation.role === "OWNER"
        ? ((yield* memberships.lockMembershipForShare(
            t,
            invitation.invitedByUserId,
            invitation.companyId,
          ))?.role ?? null)
        : null;

    if (!canAcceptInvitedRole(invitation.role, inviterCurrentRole)) {
      return yield* new RejectAccept({
        reason: "inviter_not_owner_or_missing",
        inviterRole: inviterCurrentRole,
      });
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
      Effect.catchTag("RejectAccept", (rejected) =>
        recordRejectionAndFail(actor.id, invitation, rejected),
      ),
    );

  return { companyId: invitation.companyId };
});

const recordRejectionAndFail = Effect.fn("invitation.accept.recordRejection")(function* (
  actorUserId: string,
  invitation: InvitationRow,
  rejected: RejectAccept,
) {
  const audit = yield* AuditLog;
  const payload = {
    actor_user_id: actorUserId,
    invitation_id: invitation.id,
    company_id: invitation.companyId,
    invited_by_user_id: invitation.invitedByUserId,
    attempted_role: invitation.role,
    inviter_current_role: rejected.inviterRole,
    reason: rejected.reason,
  };
  // console.warn を DB 書込みの前に置くのは DB 断でも痕跡を残すため。行の形は運用の log filter が拾う。
  yield* Effect.sync(() => console.warn(ACCEPT_REJECTED_LOG, JSON.stringify(payload)));
  yield* audit
    .recordInvitationAcceptRejected(payload)
    .pipe(swallowAuditFailure(ACCEPT_REJECTED_LOG));
  return yield* new ExpiredOrUsed();
});
