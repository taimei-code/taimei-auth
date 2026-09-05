import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canChangeRole } from "../policy";
import { type ParseBody, requireActor, requireMembershipOf, requireTargetMembership } from "./core";
import { Forbidden } from "./errors";

// 判定順: 401 → 400 (parseBody) → 403 (ADMIN 以上) → 404 (target membership) → 403 (canChangeRole)。

export const requireRoleChange = (opts: {
  headers: Headers;
  companyId: string;
  targetUserId: string;
  parseBody: ParseBody<{ nextRole: Role }>;
}) =>
  Effect.gen(function* () {
    const actor = yield* requireActor(opts.headers);
    const parsed = yield* opts.parseBody;
    const role = yield* requireMembershipOf(actor, opts.companyId, "ADMIN");
    const target = yield* requireTargetMembership(opts.targetUserId, opts.companyId);
    if (!canChangeRole(role, target.role, parsed.nextRole)) return yield* new Forbidden();
    return { actor, targetRole: target.role, nextRole: parsed.nextRole };
  });
