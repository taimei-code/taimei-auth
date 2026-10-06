import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canInviteRole } from "../policy";
import { type ParseBody, requireMembership } from "./core";
import { Forbidden } from "./errors";

// parse は 403 の判定より後 (先だと SPA が forbidden より先に zod のエラーを出す)。
export const requireInvite = Effect.fn("membership.requireInvite")(function* <
  Body extends { email: string; role: Role },
>(opts: { headers: Headers; companyId: string; parseBody: ParseBody<Body> }) {
  const { actor, role } = yield* requireMembership(opts.headers, opts.companyId, "ADMIN");
  const parsed = yield* opts.parseBody;
  if (!canInviteRole(role, parsed.role)) return yield* new Forbidden();
  return { ...parsed, actor };
});
