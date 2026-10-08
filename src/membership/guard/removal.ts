import { Effect } from "effect";
import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { requireMembership, requireTargetMembership } from "./core";
import { Forbidden } from "./errors";

export const requireRemoval = Effect.fnUntraced(function* (opts: {
  headers: Headers;
  companyId: string;
  targetUserId: string;
}) {
  const { actor, role } = yield* requireMembership(opts.headers, opts.companyId);
  const isSelf = actor.id === opts.targetUserId;
  if (!canAttemptRemoval(role, isSelf)) return yield* new Forbidden();
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canRemoveTarget(role, isSelf, target.role)) return yield* new Forbidden();
  return { actor, targetRole: target.role, isSelf };
});
