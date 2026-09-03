import { Effect } from "effect";
import { canChangeRole } from "../policy";
import { findMembership, type Role } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  forbidden,
  guard,
  type InvalidArgument,
  type NotFound,
  type ParseBodyCallback,
  parseBody,
  requireTargetMembership,
  runGuard,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 400 (parseBody) → 403 (ADMIN 以上) → 404 (target membership) → 403 (canChangeRole)。
// Effect.gen の逐次 yield* が判定順そのもので、失敗は最初の yield* で短絡する。

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

type RoleChangeOptions = {
  headers: Headers;
  companyId: string;
  targetUserId: string;
  parseBody: ParseBodyCallback<ParsedRoleBody>;
};

export function makeRequireRoleChange(deps = { guard, findMembership }) {
  const program = (opts: RoleChangeOptions) =>
    Effect.gen(function* () {
      const actor = yield* deps.guard.effect.requireActor(opts.headers);
      const body = yield* parseBody(opts.parseBody);
      const role = yield* deps.guard.effect.requireMembershipOf(actor, opts.companyId, "ADMIN");
      const target = yield* requireTargetMembership(
        deps.findMembership,
        opts.targetUserId,
        opts.companyId,
      );
      if (!canChangeRole(role, target.role, body.nextRole)) {
        return yield* Effect.fail(forbidden());
      }
      return { ok: true as const, actor, targetRole: target.role, nextRole: body.nextRole };
    });

  return (opts: RoleChangeOptions): Promise<RoleChangeGuardResult> => runGuard(program(opts));
}

export const requireRoleChange = makeRequireRoleChange();
