import { Effect } from "effect";
import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "../../failures";

export const requireRemoval = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  targetUserId: string;
}) {
  const role = yield* requireMembershipOf(opts.actor, opts.companyId);
  const isSelf = opts.actor.id === opts.targetUserId;
  if (!canAttemptRemoval(role, isSelf)) return yield* new Forbidden();
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canRemoveTarget(role, isSelf, target.role)) return yield* new Forbidden();
  return { actor: opts.actor, targetRole: target.role, isSelf };
});
