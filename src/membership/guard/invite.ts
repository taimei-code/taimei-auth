import { canInviteRole } from "../policy";
import type { Role } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  guard,
  type InvalidArgument,
  type ParseBodyCallback,
  resolveParseBody,
  type Unauthorized,
} from "./core";

// POST .../invitations の判定順 (現行実装維持):
// 401 (actor) → 403 (ADMIN 以上) → 400 (parseBody, details 付き) → 403 (canInviteRole)。
// parse を 403 の後に置くのは現行 handler の順序で、SPA が「forbidden よりも先に body の zod error を
// 見て入力欄を光らせる」誤挙動を作らないため。

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

export function makeRequireInvite(deps = { guard }) {
  return async (opts: {
    headers: Headers;
    companyId: string;
    parseBody: ParseBodyCallback<ParsedInviteBody>;
  }): Promise<InviteGuardResult> => {
    const membershipResult = await deps.guard.requireMembership(
      opts.headers,
      opts.companyId,
      "ADMIN",
    );
    if (!membershipResult.ok) return membershipResult;

    const parsed = await resolveParseBody(opts.parseBody);
    if (!parsed.ok) return parsed;

    if (!canInviteRole(membershipResult.role, parsed.data.role)) {
      return { ok: false, error: "forbidden", status: 403 };
    }

    return {
      ok: true,
      actor: membershipResult.actor,
      email: parsed.data.email,
      role: parsed.data.role,
    };
  };
}

export const requireInvite = makeRequireInvite();
