import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canChangeRole } from "../policy";
import { type ParseBody, requireActor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "./errors";

export const requireRoleChange = Effect.fnUntraced(function* (opts: {
  headers: Headers;
  companyId: string;
  targetUserId: string;
  parseBody: ParseBody<{ nextRole: Role }>;
}) {
  const actor = yield* requireActor(opts.headers);
  const parsed = yield* opts.parseBody;
  const role = yield* requireMembershipOf(actor, opts.companyId, "ADMIN");
  const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
  if (!canChangeRole(role, target.role, parsed.nextRole)) return yield* new Forbidden();
  return { actor, targetRole: target.role, nextRole: parsed.nextRole };
});
