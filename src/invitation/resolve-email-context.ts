import { Effect } from "effect";
import { UserRepo } from "../account/ports";
import { CompanyRepo } from "../company/ports";
import { roleLabelJa } from "../membership/role-label";
import { InvitationRepo } from "./ports";

export type InvitationEmailContext = {
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  roleLabel: string;
};

// sendMagicLink callback は {email, url} しか受け取らないため url から context を再構成する。
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
    companyName: company.name,
    inviterName: inviter?.name ?? "",
    inviterEmail: inviter?.email ?? "",
    roleLabel: roleLabelJa(invitation.role),
  } satisfies InvitationEmailContext;
});

function extractInvitationToken(magicLinkUrl: string): string | null {
  const callback = safeParseUrl(magicLinkUrl)?.searchParams.get("callbackURL");
  if (!callback) return null;
  const parsed = safeParseUrl(callback);
  if (!parsed) return null;
  // javascript: 等の非 http(s) スキーム callbackURL は invitation 文脈として扱わない (不正値を無視)。
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.searchParams.get("invitation_token");
}

const RELATIVE_URL_BASE = "http://localhost";

function safeParseUrl(value: string): URL | null {
  return URL.canParse(value, RELATIVE_URL_BASE) ? new URL(value, RELATIVE_URL_BASE) : null;
}
