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

// invitation 受諾の mutation use-case (Transport → Guard → Use-case → Repository の 3 層目)。
// tx を所有し PENDING guard → OWNER 招待の招待者再検証 → membership INSERT → audit を atomic に行う。
// OWNER 招待の再検証は tx 外の guard entry に置くと (invited_by_user_id, companyId) 行の
// role 判定と本 tx の INSERT commit の間に別 tx の降格 UPDATE が入る TOCTOU 窓が残るため、
// tx 内で SELECT ... FOR SHARE + canAcceptInvitedRole を並行 UPDATE と直列化させる。
// 拒否時は tx rollback → console.warn (isolate crash 対策の先行 emit) → 別 tx で audit 記録。
// 詳細: docs/adr/0012-layered-architecture.md

export type AcceptInvitationResult =
  | { ok: true; companyId: string }
  | { ok: false; reason: "expired_or_used"; audit: RejectReason };

export type RejectReason =
  | "double_accept"
  | "unknown_invited_role"
  | "inviter_not_owner_or_missing";

const ACCEPT_REJECTED_LOG = "invitation_accept_rejected" as const;

// reject を tx callback の return で表現すると drizzle は tx を commit する
// (markInvitationAccepted の UPDATE が生き残って invitation が ACCEPTED に落ちる)。
// rollback を引くため sentinel error を throw し、外側で捕えて Outcome に写像する。
// export しないのは call site が acceptInvitation の 1 箇所に閉じている encapsulation を保つため。
// 別 caller が発火時挙動を hook したい場合は AcceptInvitationResult.audit で判別可能。
class RejectAccept extends Error {
  constructor(public readonly detail: { reason: RejectReason; inviterRole: string | null }) {
    super("accept rejected (tx rollback trigger)");
    this.name = "RejectAccept";
  }
}

type Outcome =
  | { kind: "accept" }
  | { kind: "reject"; reason: RejectReason; inviterRole: string | null };

// accept 経路: 呼び出し側 (handler) は guard entry で PENDING / email_mismatch / not_found / reused
// を先に振り分けた後、proceed 経路の invitation と actor を渡す。
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

    // OWNER 招待だけ (invited_by_user_id, invitation.companyId) の 1 行を FOR SHARE lock し、
    // 並行 role 変更 UPDATE と直列化する。ADMIN/MEMBER 招待は inviter 状態に依存しないため
    // lock しない (contention を避け、招待者退会の正規ケースを壊さない — ADR-0012)。
    // 述語呼び出しは 1 回に固定し、inviterCurrentRole は「lock 対象があれば raw role、無ければ null」
    // という素直な入力を渡す (placeholder sentinel を作らない)。
    const inviterCurrentRole: string | null =
      invitation.role === "OWNER"
        ? ((await lockMembershipForShare(tx, invitation.invitedByUserId, invitation.companyId))
            ?.role ?? null)
        : null;

    if (!canAcceptInvitedRole(invitation.role, inviterCurrentRole)) {
      // reason ラベルは述語判定を再現しないよう isKnownRole で「未知 role か否か」だけ問う。
      // 未知 → unknown_invited_role (直 INSERT で不整合 role が入った異常系)、
      // それ以外 → inviter_not_owner_or_missing (OWNER 招待で inviter が非 OWNER / 行不在)。
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
  // console.warn を DB 書込みの前に emit する: isolate crash / DB 断で audit INSERT が
  // 落ちても wrangler tail に痕跡を残す at-least-once 近似。JSON 化するのは
  // Datadog log filter で invitation_id 抽出しやすくするため (運用契約: ADR-0012)。
  console.warn(ACCEPT_REJECTED_LOG, JSON.stringify(payload));
  await recordInvitationAcceptRejected(payload).catch((e) => {
    // audit INSERT 失敗は accept 応答を止めない (拒否結果自体は 410 で返す)。log は既に出ている。
    console.error("failed to persist invitation_accept_rejected audit", e);
  });

  return { ok: false, reason: "expired_or_used", audit: outcome.reason };
}
