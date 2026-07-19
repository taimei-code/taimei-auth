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
  type ParseBodyCallback,
  resolveParseBody,
  type Unauthorized,
} from "./core";

// POST /api/account/accept-invitation の判定順:
// 401 (actor) → 400 (parseBody) → 404 (token) → 403 (email_mismatch) →
// 既所属短絡 (ok, reused) → 410 (isAcceptable の失敗)。
// OWNER 招待の招待者再検証は tx 外で検証すると降格 UPDATE との TOCTOU 窓が残るため entry では
// 行わず、accept use-case の tx 内で行う (canAcceptInvitedRole 呼び出し)。

export type ParsedAcceptBody = { token: string };

export type InvitationAcceptGuardResult =
  | {
      ok: true;
      mode: "proceed";
      actor: Actor;
      invitation: InvitationRow;
    }
  // reused branch は handler が response body の company_id 1 個しか使わないので、
  // 全 InvitationRow / actor を運ばずに companyId だけ narrow する (PR #107 規律)。
  | { ok: true; mode: "reused"; companyId: string }
  | Unauthorized
  | InvalidArgument
  | NotFound
  | Forbidden
  | { ok: false; error: "email_mismatch"; status: 403 }
  | { ok: false; error: "expired_or_used"; status: 410 };

export function makeRequireInvitationAccept(
  deps = { guard, findInvitationByToken, findMembership },
) {
  return async (opts: {
    headers: Headers;
    parseBody: ParseBodyCallback<ParsedAcceptBody>;
  }): Promise<InvitationAcceptGuardResult> => {
    const actorResult = await deps.guard.requireActor(opts.headers);
    if (!actorResult.ok) return actorResult;

    const parsed = await resolveParseBody(opts.parseBody);
    if (!parsed.ok) return parsed;

    const invitation = await deps.findInvitationByToken(parsed.data.token);
    if (!invitation) return { ok: false, error: "not_found", status: 404 };

    if (invitation.email.toLowerCase() !== actorResult.actor.email.toLowerCase()) {
      return { ok: false, error: "email_mismatch", status: 403 };
    }

    // 既所属短絡 (isAcceptable より先) — 期限切れ invitation でも既所属なら 200 reused を返す
    // 冪等契約を保つ。ここは既存挙動維持。
    const already = await deps.findMembership(actorResult.actor.id, invitation.companyId);
    if (already) {
      return { ok: true, mode: "reused", companyId: invitation.companyId };
    }

    if (!isAcceptable(invitation)) {
      return { ok: false, error: "expired_or_used", status: 410 };
    }

    return { ok: true, mode: "proceed", actor: actorResult.actor, invitation };
  };
}

export const requireInvitationAccept = makeRequireInvitationAccept();
