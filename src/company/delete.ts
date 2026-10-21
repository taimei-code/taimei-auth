import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { appendAuditInTx, invitationRevokedEntry, membershipRemovedEntry } from "../audit/append";
import { InvitationRepo } from "../invitation/ports";
import { applyCompanyRemoval } from "../membership/apply-change";
import { Forbidden } from "../failures";
import type { VerifiedMember } from "../membership/guard";
import { isAtLeast } from "../membership/policy";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { CompanyRepo } from "./ports";

export const deleteCompany = Effect.fnUntraced(function* (member: VerifiedMember<"OWNER">) {
  const actorUserId = member.actor.id;
  const { companyId } = member;
  const companies = yield* CompanyRepo;
  const memberships = yield* MembershipRepo;
  const invitations = yield* InvitationRepo;
  const tx = yield* Transaction;

  const deletedUserIds = yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      yield* memberships.lockOwnerMembershipsOfCompany(t, companyId);
      const target = yield* companies.findCompanyById(companyId, t);
      if (!target) return yield* new Forbidden();
      if (target.activationStatus !== "ACTIVE") return [];

      const actorMembership = yield* memberships.findMembership(actorUserId, companyId, t);
      if (!actorMembership || !isAtLeast(actorMembership.role, "OWNER"))
        return yield* new Forbidden();

      const revokedInvitations = yield* invitations.revokePendingInvitationsOfCompany(companyId, t);
      yield* appendAuditInTx(
        t,
        ...revokedInvitations.map((inv) =>
          invitationRevokedEntry(actorUserId, { invitationId: inv.id, companyId }),
        ),
      );

      const removed = yield* applyCompanyRemoval(t, companyId);
      yield* appendAuditInTx(
        t,
        ...removed.map((m) =>
          membershipRemovedEntry(actorUserId, { companyId, userId: m.userId, role: m.role }),
        ),
      );

      const deletedOrphanIds = yield* Effect.filter(
        [...new Set(removed.map((m) => m.userId))].sort(),
        (userId) =>
          deleteAccountIfOrphaned(userId, t, "company-delete").pipe(
            Effect.map((removal) => removal === "deleted"),
          ),
      );

      yield* companies.softDeleteCompany(companyId, t);
      yield* appendAuditInTx(t, {
        eventType: "company_deleted",
        userId: actorUserId,
        payload: {
          company_id: companyId,
          name_at_deletion: target.name,
          deleted_by_user_id: actorUserId,
        },
      });

      return deletedOrphanIds;
    }),
  );
  return { actorDeleted: deletedUserIds.includes(actorUserId) };
});
