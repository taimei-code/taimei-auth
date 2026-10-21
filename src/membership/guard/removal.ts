import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "../../failures";
import { type Verified, verified } from "./verified";

export type RemovalGrant = Verified<{
  readonly actor: Actor;
  readonly companyId: string;
  readonly targetUserId: string;
  readonly targetRole: Role;
}>;

export const requireRemoval = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  targetUserId: string;
}) {
  const { role } = yield* requireMembershipOf(opts.actor, opts.companyId, "MEMBER");
  const isSelf = opts.actor.id === opts.targetUserId;
  if (!canAttemptRemoval(role, isSelf)) return yield* new Forbidden();
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canRemoveTarget(role, isSelf, target.role)) return yield* new Forbidden();
  return verified({
    actor: opts.actor,
    companyId: opts.companyId,
    targetUserId: opts.targetUserId,
    targetRole: target.role,
  }) satisfies RemovalGrant;
});
