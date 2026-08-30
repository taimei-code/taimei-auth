import {
  recordInvitationAccepted,
  recordInvitationAcceptRejected,
} from "@/db/repositories/audit-log";
import type { InvitationRow } from "@/db/repositories/invitation";
import { markInvitationAccepted } from "@/db/repositories/invitation";
import {
  generateMembershipId,
  insertMembership,
  lockMembershipForShare,
} from "@/db/repositories/membership";
import { runInTransaction } from "@/db/transaction";
import { canAcceptInvitedRole, isKnownRole } from "../membership/policy";

// ADR-0012 (Use-case 層): tx を所有し PENDING guard → OWNER 招待の招待者再検証 → membership INSERT →
// audit を atomic に行う。再検証を tx 内に置くのは降格 UPDATE が割り込む TOCTOU 窓を閉じるため。

export type AcceptInvitationResult =
  | { ok: true; companyId: string }
  | { ok: false; reason: "expired_or_used"; audit: RejectReason };

export type RejectReason =
  | "double_accept"
  | "unknown_invited_role"
  | "inviter_not_owner_or_missing";

const ACCEPT_REJECTED_LOG = "invitation_accept_rejected" as const;

// reject を return で表すと drizzle は tx を commit する (invitation が ACCEPTED に落ちる) ため、
// rollback を引く sentinel error を throw する。export しないのは call site を 1 箇所に閉じるため。
class RejectAccept extends Error {
  constructor(public readonly detail: { reason: RejectReason; inviterRole: string | null }) {
    super("accept rejected (tx rollback trigger)");
    this.name = "RejectAccept";
  }
}

type Outcome =
  | { kind: "accept" }
  | { kind: "reject"; reason: RejectReason; inviterRole: string | null };

// 呼び出し側 (handler) が guard entry で not_found / email_mismatch / reused を振り分けた後の proceed 経路。
export async function acceptInvitation(params: {
  actor: { id: string; email: string };
  invitation: InvitationRow;
}): Promise<AcceptInvitationResult> {
  const { actor, invitation } = params;

  const outcome: Outcome = await runInTransaction<Outcome>(async (tx) => {
    const accepted = await markInvitationAccepted(invitation.id, tx);
    if (!accepted) {
      // 並行 accept / revoke で PENDING が消えた。expired_or_used と同義。
      throw new RejectAccept({ reason: "double_accept", inviterRole: null });
    }

    // OWNER 招待だけ inviter の 1 行を FOR SHARE lock し、並行 role 変更 UPDATE と直列化する。
    // ADMIN/MEMBER 招待は inviter 状態に依存しないため lock しない (招待者退会を壊さない — ADR-0012)。
    const inviterCurrentRole: string | null =
      invitation.role === "OWNER"
        ? ((await lockMembershipForShare(tx, invitation.invitedByUserId, invitation.companyId))
            ?.role ?? null)
        : null;

    if (!canAcceptInvitedRole(invitation.role, inviterCurrentRole)) {
      // reason ラベルは述語判定を再現せず isKnownRole で「未知 role か否か」だけ問う (SSOT は述語)。
      const reason: RejectReason = isKnownRole(invitation.role)
        ? "inviter_not_owner_or_missing"
        : "unknown_invited_role";
      throw new RejectAccept({ reason, inviterRole: inviterCurrentRole });
    }

    await insertMembership(
      {
        id: generateMembershipId(),
        userId: actor.id,
        companyId: invitation.companyId,
        role: invitation.role,
      },
      tx,
    );
    await recordInvitationAccepted(
      {
        actor_user_id: actor.id,
        invitation_id: invitation.id,
        company_id: invitation.companyId,
        role: invitation.role,
      },
      tx,
    );
    return { kind: "accept" };
  }).catch((e) => {
    if (e instanceof RejectAccept) {
      return { kind: "reject", ...e.detail };
    }
    throw e;
  });

  if (outcome.kind === "accept") {
    return { ok: true, companyId: invitation.companyId };
  }

  const payload = {
    actor_user_id: actor.id,
    invitation_id: invitation.id,
    company_id: invitation.companyId,
    invited_by_user_id: invitation.invitedByUserId,
    attempted_role: invitation.role,
    inviter_current_role: outcome.inviterRole,
    reason: outcome.reason,
  };
  // console.warn を DB 書込みの前に emit する: isolate crash / DB 断で audit INSERT が落ちても痕跡を
  // 残す at-least-once 近似。JSON 化は log filter での invitation_id 抽出用 (運用契約: ADR-0012)。
  console.warn(ACCEPT_REJECTED_LOG, JSON.stringify(payload));
  await recordInvitationAcceptRejected(payload).catch((e) => {
    // audit INSERT 失敗は accept 応答を止めない (拒否結果自体は 410 で返す)。log は既に出ている。
    console.error("failed to persist invitation_accept_rejected audit", e);
  });

  return { ok: false, reason: "expired_or_used", audit: outcome.reason };
}
