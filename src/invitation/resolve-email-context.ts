import { Effect } from "effect";
import { UserRepo } from "../account/ports";
import { CompanyRepo } from "../company/ports";
import { toDisplayText } from "../email/sanitize";
import type { InvitationEmailParams } from "../email/send-invitation";
import { roleLabelJa } from "../membership/role-label";
import { InvitationRepo } from "./ports";

type InvitationEmailContext = Omit<InvitationEmailParams, "inviteeEmail" | "url">;

export const resolveInvitationEmailContext = Effect.fn("invitation.resolveEmailContext")(function* (
  magicLinkUrl: string,
) {
  const token = extractInvitationToken(magicLinkUrl);
  if (!token) return null;

  const invitations = yield* InvitationRepo;
  const invitation = yield* invitations.findInvitationByToken(token);
  if (!invitation) return null;

  const companies = yield* CompanyRepo;
  const users = yield* UserRepo;
  const [company, inviter] = yield* Effect.all(
    [
      companies.findCompanyById(invitation.companyId),
      users.findUserById(invitation.invitedByUserId),
    ] as const,
    { concurrency: "unbounded" },
  );
  if (!company) return null;

  return {
    companyName: toDisplayText(company.name),
    inviterName: toDisplayText(inviter?.name ?? ""),
    inviterEmail: toDisplayText(inviter?.email ?? ""),
    roleLabel: roleLabelJa(invitation.role),
  } satisfies InvitationEmailContext;
});

function extractInvitationToken(magicLinkUrl: string): string | null {
  const callback = safeParseUrl(magicLinkUrl)?.searchParams.get("callbackURL");
  if (!callback) return null;
  const parsed = safeParseUrl(callback);
  if (!parsed) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.searchParams.get("invitation_token");
}

const RELATIVE_URL_BASE = "http://localhost";

function safeParseUrl(value: string): URL | null {
  return URL.canParse(value, RELATIVE_URL_BASE) ? new URL(value, RELATIVE_URL_BASE) : null;
}
