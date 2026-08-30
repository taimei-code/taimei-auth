import { canChangeRole } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  guard,
  type InvalidArgument,
  type NotFound,
  type ParseBodyCallback,
  resolveParseBody,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 400 (parseBody) → 403 (ADMIN 以上) → 404 (target membership) → 403 (canChangeRole)。

export type ParsedRoleBody = { nextRole: Role };

export type RoleChangeGuardResult =
  | {
      ok: true;
      actor: Actor;
      targetRole: Role;
      nextRole: Role;
    }
  | Unauthorized
  | InvalidArgument
  | Forbidden
  | NotFound;

export function makeRequireRoleChange(deps = { guard, findMembership }) {
  return async (opts: {
    headers: Headers;
    companyId: string;
    targetUserId: string;
    parseBody: ParseBodyCallback<ParsedRoleBody>;
  }): Promise<RoleChangeGuardResult> => {
    const actorResult = await deps.guard.requireActor(opts.headers);
    if (!actorResult.ok) return actorResult;

    const parsed = await resolveParseBody(opts.parseBody);
    if (!parsed.ok) return parsed;

    const membershipResult = await deps.guard.requireMembershipOf(
      actorResult.actor,
      opts.companyId,
      "ADMIN",
    );
    if (!membershipResult.ok) return membershipResult;

    const targetMembership = await deps.findMembership(opts.targetUserId, opts.companyId);
    if (!targetMembership) return { ok: false, error: "not_found", status: 404 };

    if (!canChangeRole(membershipResult.role, targetMembership.role, parsed.data.nextRole)) {
      return { ok: false, error: "forbidden", status: 403 };
    }

    return {
      ok: true,
      actor: actorResult.actor,
      targetRole: targetMembership.role,
      nextRole: parsed.data.nextRole,
    };
  };
}

export const requireRoleChange = makeRequireRoleChange();
