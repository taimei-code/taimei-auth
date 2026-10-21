import { Effect } from "effect";
import type { UserRow } from "@/db/repositories/user";
import type { DbTx } from "@/db/transaction";
import { UserRepo } from "../account/ports";
import { appendAuditInTx } from "../audit/append";
import { Forbidden } from "../failures";
import { Transaction } from "../transaction";
import { MembershipRepo } from "./ports";

type UserWithCurrentCompany = Pick<UserRow, "id" | "lastUsedCompanyId">;

export const activeMembershipsOf = (userId: string) =>
  MembershipRepo.use((repo) => repo.findActiveMembershipsByUserId(userId));

export const currentRoleOf = Effect.fnUntraced(function* (user: UserWithCurrentCompany) {
  const companyId = user.lastUsedCompanyId;
  if (!companyId) return undefined;
  const membership = yield* MembershipRepo.use((repo) => repo.findMembership(user.id, companyId));
  return membership?.role;
});

export const currentCompanyMembersOf = Effect.fnUntraced(function* (user: UserWithCurrentCompany) {
  const companyId = user.lastUsedCompanyId;
  if (!companyId) return undefined;
  const members = yield* MembershipRepo.use((repo) => repo.findMembersByCompanyId(companyId));
  const caller = members.find((m) => m.userId === user.id);
  return caller && { companyId, callerRole: caller.role, members };
});

export const switchCurrentCompany = Effect.fnUntraced(function* (target: {
  userId: string;
  companyId: string;
}) {
  const { userId, companyId } = target;
  const memberships = yield* MembershipRepo;
  const users = yield* UserRepo;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t) {
      const targetMembership = yield* memberships.lockMembershipForShare(t, userId, companyId);
      if (!targetMembership) return yield* new Forbidden();
      const current = yield* users.lockCurrentCompanyOf(t, userId);
      const fromCompanyId = current?.lastUsedCompanyId ?? null;
      if (fromCompanyId === companyId) return;
      yield* users.updateUserLastUsedCompany(userId, companyId, t);
      yield* appendAuditInTx(t, {
        eventType: "company_switched",
        userId,
        payload: { from_company_id: fromCompanyId, to_company_id: companyId },
      });
    }),
  );

  return { companyId };
});

export const becomeCurrentOnJoin = (tx: DbTx, userId: string, companyId: string) =>
  UserRepo.use((users) => users.updateUserLastUsedCompany(userId, companyId, tx));

export const reassignCurrentAfterLeaving = (
  tx: DbTx,
  companyId: string,
  userIds: readonly string[],
) => UserRepo.use((users) => users.reassignLastUsedCompanyAfterLeaving(companyId, userIds, tx));
