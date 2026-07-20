import { deleteAccountIfOrphaned } from "../account/orphan";
import {
  recordCompanyDeleted,
  recordInvitationRevoked,
  recordMembershipRemoved,
} from "@/db/repositories/audit-log";
import { findCompanyById, softDeleteCompany } from "@/db/repositories/company";
import { revokePendingInvitationsOfCompany } from "@/db/repositories/invitation";
import {
  findMembership,
  lockOwnerMembershipsOfCompany,
  removeMembershipsOfCompany,
} from "@/db/repositories/membership";
import { reassignLastUsedCompanyForDeletedCompany } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";

export type DeleteCompanyResult =
  | { ok: true; actorDeleted: boolean }
  | { ok: false; reason: "forbidden" | "not_found_or_already_deleted" };

// ADR-0010 D1/D3: 事業所削除の use-case。company は soft delete、所属 (membership) は物理削除し、
// 所属 0 件になった元メンバー (= 最後の事業所を消した OWNER 自身を含む) は連動でアカウント削除する。
// invitation 失効 / membership 削除 / last_used 付け替え / orphan 削除 / soft delete / audit を単一 tx に置き、
// いずれか失敗で全 rollback する (中間状態を残さない)。設計詳細・順序根拠: docs/adr/0010-company-account-deletion-lifecycle.md
export const deleteCompany = (
  actorUserId: string,
  companyId: string,
): Promise<DeleteCompanyResult> =>
  runInTransaction(async (tx) => {
    const company = await findCompanyById(companyId, tx);
    if (!company) return { ok: false, reason: "not_found_or_already_deleted" };
    // 既に削除済みなら冪等成功 (membership も orphan も処理済み)。再削除で二重 audit しない。
    if (company.activationStatus !== "ACTIVE") return { ok: true, actorDeleted: false };

    // member remove / 並行 DeleteCompany と同じ OWNER 行を取って直列化してから authz + 本処理を行う。
    await lockOwnerMembershipsOfCompany(tx, companyId);
    // lock 取得時点で別 tx が先着削除済みなら冪等成功 (membership / audit を二重処理しない)。authz の
    // membership 読みを lock 後に置くのは、並行削除との間で「company は ACTIVE と読んだ直後に自分の
    // membership だけ cascade 済」となり誤って forbidden を返すのを防ぐため。
    const locked = await findCompanyById(companyId, tx);
    if (!locked || locked.activationStatus !== "ACTIVE") return { ok: true, actorDeleted: false };

    const actorMembership = await findMembership(actorUserId, companyId, tx);
    if (!actorMembership || actorMembership.role !== "OWNER") {
      return { ok: false, reason: "forbidden" };
    }

    const revokedInvitations = await revokePendingInvitationsOfCompany(companyId, tx);
    for (const inv of revokedInvitations) {
      await recordInvitationRevoked(
        { actor_user_id: actorUserId, invitation_id: inv.id, company_id: companyId },
        tx,
      );
    }

    const removed = await removeMembershipsOfCompany(companyId, tx);
    for (const m of removed) {
      await recordMembershipRemoved(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          removed_user_id: m.userId,
          role_at_removal: m.role,
        },
        tx,
      );
    }

    // 削除 company を last_used に握る生存メンバーを残存所属へ付け替えてから orphan を消す。
    await reassignLastUsedCompanyForDeletedCompany(companyId, tx);

    let actorDeleted = false;
    for (const userId of new Set(removed.map((m) => m.userId))) {
      const deleted = await deleteAccountIfOrphaned(userId, tx);
      if (deleted && userId === actorUserId) actorDeleted = true;
    }

    await softDeleteCompany(companyId, tx);
    await recordCompanyDeleted(
      { actor_user_id: actorUserId, company_id: companyId, name_at_deletion: company.name },
      tx,
    );

    return { ok: true, actorDeleted };
  });
