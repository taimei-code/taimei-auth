import { Clock, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { isAcceptableAt } from "../../invitation/policy";
import { InvitationRepo } from "../../invitation/ports";
import { MembershipRepo } from "../ports";
import { type Actor, type ParseBody, requireActor } from "./core";
import { EmailMismatch, ExpiredOrUsed, NotFound } from "./errors";

type InvitationAcceptGrant =
  | { mode: "proceed"; actor: Actor; invitation: InvitationRow }
  // reused の分岐では handler が company_id しか使わないため、companyId だけに narrow する (PR #107 の規律)。
  | { mode: "reused"; companyId: string };

export const requireInvitationAccept = Effect.fn("membership.requireInvitationAccept")(
  function* (opts: { headers: Headers; parseBody: ParseBody<{ token: string }> }) {
    const actor = yield* requireActor(opts.headers);
    const parsed = yield* opts.parseBody;
    const invitation = yield* InvitationRepo.use((invitations) =>
      invitations.findInvitationByToken(parsed.token),
    );
    if (!invitation) return yield* new NotFound();
    if (invitation.email.toLowerCase() !== actor.email.toLowerCase())
      return yield* new EmailMismatch();
    // 既に所属していればここで返す (isAcceptable より先)。期限切れでも既所属なら 200 reused を返す冪等の契約を保つ。
    const existingMembership = yield* MembershipRepo.use((memberships) =>
      memberships.findMembership(actor.id, invitation.companyId),
    );
    if (existingMembership)
      return { mode: "reused", companyId: invitation.companyId } satisfies InvitationAcceptGrant;
    if (!isAcceptableAt(invitation, yield* Clock.currentTimeMillis))
      return yield* new ExpiredOrUsed();
    return { mode: "proceed", actor, invitation } satisfies InvitationAcceptGrant;
  },
);
