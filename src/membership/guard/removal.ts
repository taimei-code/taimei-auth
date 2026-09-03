import { Effect } from "effect";
import { canAttemptRemoval, canRemoveTarget } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  forbidden,
  guard,
  type NotFound,
  requireTargetMembership,
  runGuard,
  type Unauthorized,
} from "./core";

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

type RemovalOptions = {
  headers: Headers;
  companyId: string;
  targetUserId: string;
};

export function makeRequireRemoval(deps = { guard, findMembership }) {
  const program = (opts: RemovalOptions) =>
    Effect.gen(function* () {
      const { actor, role } = yield* deps.guard.effect.requireMembership(
        opts.headers,
        opts.companyId,
      );
      const isSelf = actor.id === opts.targetUserId;
      if (!canAttemptRemoval(role, isSelf)) return yield* Effect.fail(forbidden());

      const target = yield* requireTargetMembership(
        deps.findMembership,
        opts.targetUserId,
        opts.companyId,
      );
      if (!canRemoveTarget(role, isSelf, target.role)) return yield* Effect.fail(forbidden());

      return { ok: true as const, actor, targetRole: target.role, isSelf };
    });

  return (opts: RemovalOptions): Promise<RemovalGuardResult> => runGuard(program(opts));
}

export const requireRemoval = makeRequireRemoval();
