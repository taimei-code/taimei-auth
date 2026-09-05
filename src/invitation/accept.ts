import { Data, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { swallowAuditFailure } from "../audit/report-failure";
import { IdGenerator } from "../id-generator";
import { canAcceptInvitedRole, isKnownRole } from "../membership/policy";
import { ExpiredOrUsed } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import type { RejectReason } from "./errors";
import { InvitationRepo } from "./ports";

// ADR-0012 (Use-case 層): tx を所有し PENDING guard → OWNER 招待の招待者再検証 → membership INSERT →
// audit を atomic に行う。再検証を tx 内に置くのは降格 UPDATE が割り込む TOCTOU 窓を閉じるため。

const ACCEPT_REJECTED_LOG = "invitation_accept_rejected" as const;

// tx 内の拒否を rollback させつつ理由を運ぶ内部 failure (Transaction は failure を必ず rollback する)。
// export しないのは call site を 1 箇所に閉じるため。tx の外で audit / log に写した後 ExpiredOrUsed へ載せ替える。
class RejectAccept extends Data.TaggedError("RejectAccept")<{
  readonly reason: RejectReason;
  readonly inviterRole: string | null;
}> {}

// 呼び出し側 (handler) が guard entry で not_found / email_mismatch / reused を振り分けた後の proceed 経路。
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
    // 並行 accept / revoke で PENDING が消えた。expired_or_used と同義。
    if (!accepted) return yield* new RejectAccept({ reason: "double_accept", inviterRole: null });

    // OWNER 招待だけ inviter の 1 行を FOR SHARE lock し、並行 role 変更 UPDATE と直列化する。
    // ADMIN/MEMBER 招待は inviter 状態に依存しないため lock しない (招待者退会を壊さない — ADR-0012)。
    const inviterCurrentRole: string | null =
      invitation.role === "OWNER"
        ? ((yield* memberships.lockMembershipForShare(
            t,
            invitation.invitedByUserId,
            invitation.companyId,
          ))?.role ?? null)
        : null;

    if (!canAcceptInvitedRole(invitation.role, inviterCurrentRole)) {
      // reason ラベルは述語判定を再現せず isKnownRole で「未知 role か否か」だけ問う (SSOT は述語)。
      const reason: RejectReason = isKnownRole(invitation.role)
        ? "inviter_not_owner_or_missing"
        : "unknown_invited_role";
      return yield* new RejectAccept({ reason, inviterRole: inviterCurrentRole });
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

  // 拒否時の log / audit は tx の外 (rollback 済みの別 tx) で行う。catchTag は tx.run の後段なので、
  // ここに書いた副作用が accept 側の tx に混ざることはない。
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
  // console.warn を DB 書込みの前に emit する: isolate crash / DB 断で audit INSERT が落ちても痕跡を
  // 残す at-least-once 近似。JSON 化は log filter での invitation_id 抽出用 (運用契約: ADR-0012)。
  // Effect.log* に寄せると行の形が変わり運用の log filter が外れるため console.warn のまま置く。
  yield* Effect.sync(() => console.warn(ACCEPT_REJECTED_LOG, JSON.stringify(payload)));
  // audit INSERT 失敗は accept 応答を止めない (拒否結果自体は 410 で返す)。log は既に出ている。
  yield* audit
    .recordInvitationAcceptRejected(payload)
    .pipe(swallowAuditFailure(ACCEPT_REJECTED_LOG));
  // wire は guard の受諾不能と同じ 410 / expired_or_used。拒否の内訳は audit payload の reason が持つ。
  return yield* new ExpiredOrUsed();
});
