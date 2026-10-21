import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canChangeRole } from "../policy";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "../../failures";
import { type Verified, verified } from "./verified";

export type RoleChangeGrant = Verified<{
  readonly actor: Actor;
  readonly companyId: string;
  readonly targetUserId: string;
  readonly targetRole: Role;
  readonly nextRole: Role;
}>;

export const requireRoleChange = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  targetUserId: string;
  nextRole: Role;
}) {
  const { role } = yield* requireMembershipOf(opts.actor, opts.companyId, "ADMIN");
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canChangeRole(role, target.role, opts.nextRole)) return yield* new Forbidden();
  return verified({
    actor: opts.actor,
    companyId: opts.companyId,
    targetUserId: opts.targetUserId,
    targetRole: target.role,
    nextRole: opts.nextRole,
  }) satisfies RoleChangeGrant;
});
