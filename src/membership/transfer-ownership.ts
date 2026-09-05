import { Effect } from "effect";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { MembershipRepo } from "./ports";

// ADR-0012 (Use-case 層): オーナー委譲手続。target 昇格 + actor 降格を単一 tx で行い、withOwnerLockGuard の
// FOR UPDATE 直列化で並行委譲を捌く。lock guard 内 count が < 1 になったら LastOwner が E に載る。
export const transferOwnership = Effect.fn("membership.transferOwnership")(function* (params: {
  actorUserId: string;
  toUserId: string;
  companyId: string;
}) {
  const { actorUserId, toUserId, companyId } = params;
  const memberships = yield* MembershipRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  yield* tx.run((t) =>
    memberships.withOwnerLockGuard(
      t,
      companyId,
      Effect.fn("membership.transferOwnership.apply")(function* (ownerLockedTx) {
        yield* memberships.updateMembershipRole(toUserId, companyId, "OWNER", ownerLockedTx);
        yield* memberships.updateMembershipRole(actorUserId, companyId, "ADMIN", ownerLockedTx);
        yield* audit.recordOwnershipTransferred(
          {
            actor_user_id: actorUserId,
            company_id: companyId,
            from_user_id: actorUserId,
            to_user_id: toUserId,
          },
          ownerLockedTx,
        );
      }),
    ),
  );
});
