import { Effect } from "effect";
import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { requireMembership, requireTargetMembership } from "./core";
import { Forbidden } from "./errors";

// 判定順: 401 → 403 (非所属) → 403 (canAttemptRemoval) → 404 (target) → 403 (canRemoveTarget)。body なし。

export const requireRemoval = (opts: {
  headers: Headers;
  companyId: string;
  targetUserId: string;
}) =>
  Effect.gen(function* () {
    const { actor, role } = yield* requireMembership(opts.headers, opts.companyId);
    const isSelf = actor.id === opts.targetUserId;
    if (!canAttemptRemoval(role, isSelf)) return yield* new Forbidden();
    const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
    if (!canRemoveTarget(role, isSelf, target.role)) return yield* new Forbidden();
    return { actor, targetRole: target.role, isSelf };
  });
