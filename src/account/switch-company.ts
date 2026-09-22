import { Effect } from "effect";
import { AuditLog } from "../audit/ports";
import { Forbidden } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { UserRepo } from "./ports";

export const switchCompany = Effect.fn("account.switchCompany")(function* (params: {
  actorUserId: string;
  fromCompanyId: string | null;
  targetCompanyId: string;
}) {
  const { actorUserId, fromCompanyId, targetCompanyId } = params;
  if (fromCompanyId === targetCompanyId) return { companyId: targetCompanyId };

  const memberships = yield* MembershipRepo;
  const users = yield* UserRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  yield* tx.run(
    Effect.fn("account.switchCompany.apply")(function* (t) {
      const targetMembership = yield* memberships.findMembership(actorUserId, targetCompanyId, t);
      if (!targetMembership) return yield* new Forbidden();
      yield* users.updateUserLastUsedCompany(actorUserId, targetCompanyId, t);
      yield* audit.recordCompanySwitched(
        {
          actor_user_id: actorUserId,
          from_company_id: fromCompanyId,
          to_company_id: targetCompanyId,
        },
        t,
      );
    }),
  );

  return { companyId: targetCompanyId };
});
