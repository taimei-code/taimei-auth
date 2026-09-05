import { Effect } from "effect";
import { AuditLog } from "../audit/ports";
import { Forbidden } from "../membership/guard/errors";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { UserRepo } from "./ports";

// ADR-0012 (Use-case 層): 事業所切替手続。last_used_company_id を target に付け替える。同一 company は
// 200 短絡で tx / audit なし。fromCompanyId は guard が読んだ同 request の user 行から受け取る (再 SELECT を避ける)。
// membership の存在は tx 内で再確認する — tx 外 check と更新の間に除名が入る TOCTOU を直列化するため。
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
      yield* users.updateLastUsedCompany(actorUserId, targetCompanyId, t);
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
