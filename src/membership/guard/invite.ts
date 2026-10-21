import { Effect } from "effect";
import type { Role } from "@/db/repositories/membership";
import type { RedirectTarget } from "../../sign-in-params";
import { canInviteRole } from "../policy";
import { type Actor, requireMembershipOf } from "./core";
import { Forbidden } from "../../failures";
import { type Verified, verified } from "./verified";

export type InviteGrant = Verified<{
  readonly actor: Actor;
  readonly companyId: string;
  readonly email: string;
  readonly role: Role;
  readonly redirectTarget: RedirectTarget | undefined;
}>;

export const requireInvite = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  companyId: string;
  body: { email: string; role: Role; redirect_target?: RedirectTarget };
}) {
  const member = yield* requireMembershipOf(opts.actor, opts.companyId, "ADMIN");
  if (!canInviteRole(member.role, opts.body.role)) return yield* new Forbidden();
  return verified({
    actor: opts.actor,
    companyId: opts.companyId,
    email: opts.body.email,
    role: opts.body.role,
    redirectTarget: opts.body.redirect_target,
  }) satisfies InviteGrant;
});
