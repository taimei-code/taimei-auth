import { Clock, Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { isAcceptableAt } from "../../invitation/policy";
import { InvitationRepo } from "../../invitation/ports";
import { MembershipRepo } from "../ports";
import { type Actor, type ParseBody, requireActor } from "./core";
import { EmailMismatch, ExpiredOrUsed, NotFound } from "./errors";

// 判定順: 401 → 400 → 404 (token) → 403 (email_mismatch) → 既所属短絡 (reused) → 410 (isAcceptable)。
// OWNER 招待の招待者再検証は降格 UPDATE との TOCTOU を避けるため entry でなく accept use-case の tx 内。

export type InvitationAcceptGrant =
  | { mode: "proceed"; actor: Actor; invitation: InvitationRow }
  // reused branch は handler が company_id しか使わないため companyId だけ narrow する (PR #107 規律)。
  | { mode: "reused"; companyId: string };

export const requireInvitationAccept = (opts: {
  headers: Headers;
  parseBody: ParseBody<{ token: string }>;
}) =>
  Effect.gen(function* () {
    const actor = yield* requireActor(opts.headers);
    const parsed = yield* opts.parseBody;
    const invitations = yield* InvitationRepo;
    const invitation = yield* invitations.findByToken(parsed.token);
    if (!invitation) return yield* new NotFound();
    if (invitation.email.toLowerCase() !== actor.email.toLowerCase())
      return yield* new EmailMismatch();
    // 既所属短絡 (isAcceptable より先) — 期限切れでも既所属なら 200 reused を返す冪等契約を保つ。
    const memberships = yield* MembershipRepo;
    const existingMembership = yield* memberships.findMembership(actor.id, invitation.companyId);
    if (existingMembership)
      return { mode: "reused", companyId: invitation.companyId } satisfies InvitationAcceptGrant;
    if (!isAcceptableAt(invitation, yield* Clock.currentTimeMillis))
      return yield* new ExpiredOrUsed();
    return { mode: "proceed", actor, invitation } satisfies InvitationAcceptGrant;
  });
