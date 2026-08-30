import { deleteAccountIfOrphaned } from "../account/orphan";
import {
  recordCompanyDeleted,
  recordInvitationsRevoked,
  recordMembershipsRemoved,
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

// ADR-0010 D1/D3 (Use-case 層): company は soft delete、membership は物理削除し、所属 0 件になった元
// メンバーは連動でアカウント削除する。全手順を単一 tx に置き、いずれか失敗で全 rollback する。
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
    // lock 後に先着削除済みなら冪等成功。authz の membership 読みを lock 後に置くのは、並行削除との間で
    // 「company は ACTIVE と読んだ直後に自分の membership だけ cascade 済」の誤 forbidden を防ぐため。
    const locked = await findCompanyById(companyId, tx);
    if (!locked || locked.activationStatus !== "ACTIVE") return { ok: true, actorDeleted: false };

    const actorMembership = await findMembership(actorUserId, companyId, tx);
    if (!actorMembership || actorMembership.role !== "OWNER") {
      return { ok: false, reason: "forbidden" };
    }

    const revokedInvitations = await revokePendingInvitationsOfCompany(companyId, tx);
    await recordInvitationsRevoked(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        invitation_ids: revokedInvitations.map((inv) => inv.id),
      },
      tx,
    );

    const removed = await removeMembershipsOfCompany(companyId, tx);
    await recordMembershipsRemoved(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        removed: removed.map((m) => ({ user_id: m.userId, role_at_removal: m.role })),
      },
      tx,
    );

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
