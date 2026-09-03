import { Effect } from "effect";
import {
  findInvitationByToken,
  type InvitationRow,
  isAcceptable,
} from "@/db/repositories/invitation";
import { findMembership } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  guard,
  type InvalidArgument,
  type NotFound,
  notFound,
  type ParseBodyCallback,
  parseBody,
  runGuard,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 400 → 404 (token) → 403 (email_mismatch) → 既所属短絡 (reused) → 410 (isAcceptable)。
// OWNER 招待の招待者再検証は降格 UPDATE との TOCTOU を避けるため entry でなく accept use-case の tx 内。

export type ParsedAcceptBody = { token: string };

type EmailMismatch = { ok: false; error: "email_mismatch"; status: 403 };
type ExpiredOrUsed = { ok: false; error: "expired_or_used"; status: 410 };

export type InvitationAcceptGuardResult =
  | {
      ok: true;
      mode: "proceed";
      actor: Actor;
      invitation: InvitationRow;
    }
  // reused branch は handler が company_id しか使わないため companyId だけ narrow する (PR #107 規律)。
  | { ok: true; mode: "reused"; companyId: string }
  | Unauthorized
  | InvalidArgument
  | NotFound
  | Forbidden
  | EmailMismatch
  | ExpiredOrUsed;

type InvitationAcceptOptions = {
  headers: Headers;
  parseBody: ParseBodyCallback<ParsedAcceptBody>;
};

const emailMismatch = (): EmailMismatch => ({ ok: false, error: "email_mismatch", status: 403 });
const expiredOrUsed = (): ExpiredOrUsed => ({ ok: false, error: "expired_or_used", status: 410 });

export function makeRequireInvitationAccept(
  deps = { guard, findInvitationByToken, findMembership },
) {
  const program = (opts: InvitationAcceptOptions) =>
    Effect.gen(function* () {
      const actor = yield* deps.guard.effect.requireActor(opts.headers);
      const body = yield* parseBody(opts.parseBody);

      // repository の throw は Effect.promise が defect にするため伝播し 500 になる (従来の await と同じ)。
      const invitation = yield* Effect.promise(() => deps.findInvitationByToken(body.token));
      if (!invitation) return yield* Effect.fail(notFound());

      if (invitation.email.toLowerCase() !== actor.email.toLowerCase()) {
        return yield* Effect.fail(emailMismatch());
      }

      // 既所属短絡 (isAcceptable より先) — 期限切れでも既所属なら 200 reused を返す冪等契約を保つ。
      const already = yield* Effect.promise(() =>
        deps.findMembership(actor.id, invitation.companyId),
      );
      if (already) {
        return { ok: true as const, mode: "reused" as const, companyId: invitation.companyId };
      }

      if (!isAcceptable(invitation)) return yield* Effect.fail(expiredOrUsed());

      return { ok: true as const, mode: "proceed" as const, actor, invitation };
    });

  return (opts: InvitationAcceptOptions): Promise<InvitationAcceptGuardResult> =>
    runGuard(program(opts));
}

export const requireInvitationAccept = makeRequireInvitationAccept();
