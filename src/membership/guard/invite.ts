import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import { canInviteRole } from "../policy";
import { type Actor, requireMembershipOf } from "./core";
import { Forbidden } from "../../failures";

export const requireInvite = Effect.fnUntraced(function* <
  Body extends { email: string; role: Role },
>(opts: { actor: Actor; companyId: string; body: Body }) {
  const role = yield* requireMembershipOf(opts.actor, opts.companyId, "ADMIN");
  if (!canInviteRole(role, opts.body.role)) return yield* new Forbidden();
  return { ...opts.body, actor: opts.actor };
});
