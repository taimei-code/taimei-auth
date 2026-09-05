import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { Transaction } from "../transaction";
import { NotFound } from "./guard/errors";
import { MembershipRepo } from "./ports";

// ADR-0012 (Use-case 層): membership.role の変更手続。tx / audit / OWNER≥1 保証と no-op 短絡を所有する。
// OWNER→非 OWNER の降格のみ withOwnerLockGuard で守り、割ると LastOwner が E に載る (wiring が写像)。
export const changeRole = Effect.fn("membership.changeRole")(function* (params: {
  actorUserId: string;
  targetUserId: string;
  companyId: string;
  beforeRole: Role;
  nextRole: Role;
}) {
  const { actorUserId, targetUserId, companyId, beforeRole, nextRole } = params;

  // no-op 短絡: beforeRole と一致するなら tx open / audit を発火しない (tx 数 metric の silent 増を防ぐ)。
  if (beforeRole === nextRole) return;

  const memberships = yield* MembershipRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  const apply = Effect.fn("membership.changeRole.apply")(function* (t: DbTx) {
    const updated = yield* memberships.updateMembershipRole(targetUserId, companyId, nextRole, t);
    if (!updated) return yield* new NotFound();
    yield* audit.recordRoleChanged(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        target_user_id: targetUserId,
        before_role: beforeRole,
        after_role: nextRole,
      },
      t,
    );
  });

  const demotesOwner = beforeRole === "OWNER" && nextRole !== "OWNER";
  yield* tx.run((t) =>
    demotesOwner ? memberships.withOwnerLockGuard(t, companyId, apply) : apply(t),
  );
});
