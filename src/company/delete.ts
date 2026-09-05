import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { UserRepo } from "../account/ports";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { AuditLog } from "../audit/ports";
import { InvitationRepo } from "../invitation/ports";
import { Forbidden } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { NotFoundOrAlreadyDeleted } from "./errors";
import { CompanyRepo } from "./ports";

// ADR-0010 D1/D3 (Use-case 層): company は soft delete、membership は物理削除し、所属 0 件になった元
// メンバーは連動でアカウント削除する。全手順を単一 tx に置き、いずれか失敗で全 rollback する
// (Transaction service の不変条件: tx 内の failure / defect は常に rollback)。
export const deleteCompany = Effect.fn("company.deleteCompany")(function* (
  actorUserId: string,
  companyId: string,
) {
  const companies = yield* CompanyRepo;
  const memberships = yield* MembershipRepo;
  const invitations = yield* InvitationRepo;
  const users = yield* UserRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("company.deleteCompany.apply")(function* (t: DbTx) {
      const target = yield* companies.findById(companyId, t);
      if (!target) return yield* new NotFoundOrAlreadyDeleted();
      // 既に削除済みなら冪等成功 (membership も orphan も処理済み)。再削除で二重 audit しない。
      if (target.activationStatus !== "ACTIVE") return { actorDeleted: false };

      // member remove / 並行 DeleteCompany と同じ OWNER 行を取って直列化してから authz + 本処理を行う。
      yield* memberships.lockOwnerMembershipsOfCompany(t, companyId);
      // lock 後に先着削除済みなら冪等成功。authz の membership 読みを lock 後に置くのは、並行削除との間で
      // 「company は ACTIVE と読んだ直後に自分の membership だけ cascade 済」の誤 forbidden を防ぐため。
      const locked = yield* companies.findById(companyId, t);
      if (!locked || locked.activationStatus !== "ACTIVE") return { actorDeleted: false };

      const actorMembership = yield* memberships.findMembership(actorUserId, companyId, t);
      if (!actorMembership || actorMembership.role !== "OWNER") return yield* new Forbidden();

      const revokedInvitations = yield* invitations.revokePendingOfCompany(companyId, t);
      yield* audit.recordInvitationsRevoked(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          invitation_ids: revokedInvitations.map((inv) => inv.id),
        },
        t,
      );

      const removed = yield* memberships.removeMembershipsOfCompany(companyId, t);
      yield* audit.recordMembershipsRemoved(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          removed: removed.map((m) => ({ user_id: m.userId, role_at_removal: m.role })),
        },
        t,
      );

      // 削除 company を last_used に握る生存メンバーを残存所属へ付け替えてから orphan を消す。
      yield* users.reassignLastUsedCompanyForDeletedCompany(companyId, t);

      let actorDeleted = false;
      for (const userId of new Set(removed.map((m) => m.userId))) {
        const deleted = yield* deleteAccountIfOrphaned(userId, t);
        if (deleted && userId === actorUserId) actorDeleted = true;
      }

      yield* companies.softDelete(companyId, t);
      yield* audit.recordCompanyDeleted(
        { actor_user_id: actorUserId, company_id: companyId, name_at_deletion: target.name },
        t,
      );

      return { actorDeleted };
    }),
  );
});
