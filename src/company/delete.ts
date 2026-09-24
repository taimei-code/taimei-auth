import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { AuditLog } from "../audit/ports";
import { InvitationRepo } from "../invitation/ports";
import { applyCompanyRemoval } from "../membership/apply-change";
import { Forbidden } from "../membership/guard/errors";
import { isAtLeast } from "../membership/policy";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { CompanyRepo } from "./ports";

export const deleteCompany = Effect.fn("company.deleteCompany")(function* (
  actorUserId: string,
  companyId: string,
) {
  const companies = yield* CompanyRepo;
  const memberships = yield* MembershipRepo;
  const invitations = yield* InvitationRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("company.deleteCompany.apply")(function* (t: DbTx) {
      yield* memberships.lockOwnerMembershipsOfCompany(t, companyId);
      const target = yield* companies.findCompanyById(companyId, t);
      if (!target) return yield* new Forbidden();
      if (target.activationStatus !== "ACTIVE") return { actorDeleted: false };

      const actorMembership = yield* memberships.findMembership(actorUserId, companyId, t);
      if (!actorMembership || !isAtLeast(actorMembership.role, "OWNER"))
        return yield* new Forbidden();

      const revokedInvitations = yield* invitations.revokePendingInvitationsOfCompany(companyId, t);
      yield* audit.recordInvitationsRevoked(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          invitation_ids: revokedInvitations.map((inv) => inv.id),
        },
        t,
      );

      const removed = yield* applyCompanyRemoval(t, companyId);
      yield* audit.recordMembershipsRemoved(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          removed: removed.map((m) => ({ user_id: m.userId, role_at_removal: m.role })),
        },
        t,
      );

      const orphanUserIds = yield* Effect.filter(
        [...new Set(removed.map((m) => m.userId))],
        (userId) => deleteAccountIfOrphaned(userId, t),
      );

      yield* companies.softDeleteCompany(companyId, t);
      yield* audit.recordCompanyDeleted(
        { actor_user_id: actorUserId, company_id: companyId, name_at_deletion: target.name },
        t,
      );

      return { actorDeleted: orphanUserIds.includes(actorUserId) };
    }),
  );
});
