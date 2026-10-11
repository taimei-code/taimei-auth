import { Clock, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { isAcceptableAt } from "../../invitation/policy";
import { InvitationRepo } from "../../invitation/ports";
import { MembershipRepo } from "../ports";
import type { Actor } from "./core";
import { EmailMismatch, ExpiredOrUsed, NotFound } from "./errors";

type InvitationAcceptGrant =
  | { mode: "proceed"; actor: Actor; invitation: InvitationRow }
  | { mode: "reused"; companyId: string };

export const requireInvitationAccept = Effect.fnUntraced(function* (opts: {
  actor: Actor;
  token: string;
}) {
  const { actor } = opts;
  const invitation = yield* InvitationRepo.use((invitations) =>
    invitations.findInvitationByToken(opts.token),
  );
  if (!invitation) return yield* new NotFound();
  if (invitation.email.toLowerCase() !== actor.email.toLowerCase())
    return yield* new EmailMismatch();
  const existingMembership = yield* MembershipRepo.use((memberships) =>
    memberships.findMembership(actor.id, invitation.companyId),
  );
  if (existingMembership)
    return { mode: "reused", companyId: invitation.companyId } satisfies InvitationAcceptGrant;
  if (!isAcceptableAt(invitation, yield* Clock.currentTimeMillis))
    return yield* new ExpiredOrUsed();
  return { mode: "proceed", actor, invitation } satisfies InvitationAcceptGrant;
});
