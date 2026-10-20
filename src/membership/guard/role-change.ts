import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canChangeRole } from "../policy";
import { type Actor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "../../failures";

export const requireRoleChange = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  targetUserId: string;
  nextRole: Role;
}) {
  const role = yield* requireMembershipOf(opts.actor, opts.companyId, "ADMIN");
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canChangeRole(role, target.role, opts.nextRole)) return yield* new Forbidden();
  return { actor: opts.actor, targetRole: target.role, nextRole: opts.nextRole };
});
