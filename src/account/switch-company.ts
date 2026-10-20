import { Effect } from "effect";
import { appendAuditInTx } from "../audit/append";
import { Forbidden } from "../failures";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { UserRepo } from "./ports";

export const switchCompany = Effect.fnUntraced(function* (params: {
  actorUserId: string;
  fromCompanyId: string | null;
  targetCompanyId: string;
}) {
  const { actorUserId, fromCompanyId, targetCompanyId } = params;
  if (fromCompanyId === targetCompanyId) return { companyId: targetCompanyId };

  const memberships = yield* MembershipRepo;
  const users = yield* UserRepo;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fnUntraced(function* (t) {
      const targetMembership = yield* memberships.lockMembershipForShare(
        t,
        actorUserId,
        targetCompanyId,
      );
      if (!targetMembership) return yield* new Forbidden();
      yield* users.updateUserLastUsedCompany(actorUserId, targetCompanyId, t);
      yield* appendAuditInTx(t, {
        eventType: "company_switched",
        userId: actorUserId,
        payload: { from_company_id: fromCompanyId, to_company_id: targetCompanyId },
      });
    }),
  );

  return { companyId: targetCompanyId };
});
