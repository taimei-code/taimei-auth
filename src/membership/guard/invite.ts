import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canInviteRole } from "../policy";
import { type ParseBody, requireMembership } from "./core";
import { Forbidden } from "./errors";

// 判定順: 401 → 403 (ADMIN 以上) → 400 (parseBody, details 付き) → 403 (canInviteRole)。parse を 403 の後に
// 置くのは、SPA が forbidden より先に zod error を見て入力欄を光らせる誤挙動を作らないため。

export const requireInvite = (opts: {
  headers: Headers;
  companyId: string;
  parseBody: ParseBody<{ email: string; role: Role }>;
}) =>
  Effect.gen(function* () {
    const { actor, role } = yield* requireMembership(opts.headers, opts.companyId, "ADMIN");
    const parsed = yield* opts.parseBody;
    if (!canInviteRole(role, parsed.role)) return yield* new Forbidden();
    return { actor, email: parsed.email, role: parsed.role };
  });
