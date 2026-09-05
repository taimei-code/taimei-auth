import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../account/orphan";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { MembershipRepo } from "./ports";

// ADR-0010 D2: 除名 / 退会の mutation。membership を物理削除し所属 0 件になった対象を連動削除する。
// OWNER を抜く場合は withOwnerLockGuard で「OWNER ≥ 1」を守り、割る場合は orphan 削除ごと rollback する
// (LastOwner が E に載る)。
export const removeMember = Effect.fn("membership.removeMember")(function* (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  targetRole: Role;
}) {
  const { actorUserId, targetUserId, companyId, targetRole } = params;
  const memberships = yield* MembershipRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  const apply = Effect.fn("membership.removeMember.apply")(function* (t: DbTx) {
    yield* memberships.deleteMembership(targetUserId, companyId, t);
    yield* audit.recordMembershipRemoved(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        removed_user_id: targetUserId,
        role_at_removal: targetRole,
      },
      t,
    );
    return { accountDeleted: yield* deleteAccountIfOrphaned(targetUserId, t) };
  });

  return yield* tx.run((t) =>
    targetRole === "OWNER" ? memberships.withOwnerLockGuard(t, companyId, apply) : apply(t),
  );
});
