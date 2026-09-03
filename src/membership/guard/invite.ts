import { Effect } from "effect";
import { canInviteRole } from "../policy";
import type { Role } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  forbidden,
  guard,
  type InvalidArgument,
  type ParseBodyCallback,
  parseBody,
  runGuard,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 403 (ADMIN 以上) → 400 (parseBody, details 付き) → 403 (canInviteRole)。parse を 403 の後に
// 置くのは、SPA が forbidden より先に zod error を見て入力欄を光らせる誤挙動を作らないため。

export type ParsedInviteBody = { email: string; role: Role };

export type InviteGuardResult =
  | {
      ok: true;
      actor: Actor;
      email: string;
      role: Role;
    }
  | Unauthorized
  | Forbidden
  | InvalidArgument;

type InviteOptions = {
  headers: Headers;
  companyId: string;
  parseBody: ParseBodyCallback<ParsedInviteBody>;
};

export function makeRequireInvite(deps = { guard }) {
  const program = (opts: InviteOptions) =>
    Effect.gen(function* () {
      const { actor, role } = yield* deps.guard.effect.requireMembership(
        opts.headers,
        opts.companyId,
        "ADMIN",
      );
      const body = yield* parseBody(opts.parseBody);
      if (!canInviteRole(role, body.role)) return yield* Effect.fail(forbidden());

      return { ok: true as const, actor, email: body.email, role: body.role };
    });

  return (opts: InviteOptions): Promise<InviteGuardResult> => runGuard(program(opts));
}

export const requireInvite = makeRequireInvite();
