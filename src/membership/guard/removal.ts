import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import { type Actor, type Forbidden, guard, type NotFound, type Unauthorized } from "./core";

// 判定順: 401 → 403 (非所属) → 403 (canAttemptRemoval) → 404 (target) → 403 (canRemoveTarget)。body なし。

export type RemovalGuardResult =
  | {
      ok: true;
      actor: Actor;
      targetRole: Role;
      isSelf: boolean;
    }
  | Unauthorized
  | Forbidden
  | NotFound;

export function makeRequireRemoval(deps = { guard, findMembership }) {
  return async (opts: {
    headers: Headers;
    companyId: string;
    targetUserId: string;
  }): Promise<RemovalGuardResult> => {
    const membershipResult = await deps.guard.requireMembership(opts.headers, opts.companyId);
    if (!membershipResult.ok) return membershipResult;

    const isSelf = membershipResult.actor.id === opts.targetUserId;
    if (!canAttemptRemoval(membershipResult.role, isSelf)) {
      return { ok: false, error: "forbidden", status: 403 };
    }

    const targetMembership = await deps.findMembership(opts.targetUserId, opts.companyId);
    if (!targetMembership) return { ok: false, error: "not_found", status: 404 };

    if (!canRemoveTarget(membershipResult.role, isSelf, targetMembership.role)) {
      return { ok: false, error: "forbidden", status: 403 };
    }

    return {
      ok: true,
      actor: membershipResult.actor,
      targetRole: targetMembership.role,
      isSelf,
    };
  };
}

export const requireRemoval = makeRequireRemoval();
