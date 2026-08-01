import { findCompanyById } from "@/db/repositories/company";
import { findInvitationByToken } from "@/db/repositories/invitation";
import { findUserById } from "@/db/repositories/user";
import { roleLabel } from "../email/send-invitation";

export type InvitationEmailContext = {
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  roleLabel: string;
};

// magic link verify URL の callbackURL に invitation_token が載っていれば、
// 招待メール描画に必要な company / inviter 情報を解決する。invitation 経由でなければ null。
// better-auth の sendMagicLink callback は {email, url} しか受け取らないため、
// url から callbackURL → invitation_token を辿って context を再構成する。
export async function resolveInvitationEmailContext(
  magicLinkUrl: string,
): Promise<InvitationEmailContext | null> {
  const token = extractInvitationToken(magicLinkUrl);
  if (!token) return null;

  const invitation = await findInvitationByToken(token);
  if (!invitation) return null;

  const [company, inviter] = await Promise.all([
    findCompanyById(invitation.companyId),
    findUserById(invitation.invitedByUserId),
  ]);
  if (!company) return null;

  return {
    companyName: company.name,
    inviterName: inviter?.name ?? "",
    inviterEmail: inviter?.email ?? "",
    roleLabel: roleLabel(invitation.role),
  };
}

function extractInvitationToken(magicLinkUrl: string): string | null {
  // magicLinkUrl 例: https://auth.../api/auth/magic-link/verify?token=...&callbackURL=<encoded>
  const callback = safeParseUrl(magicLinkUrl)?.searchParams.get("callbackURL");
  if (!callback) return null;
  // callbackURL は相対 / 絶対どちらもあり得るため dummy base で parse
  const parsed = safeParseUrl(callback);
  if (!parsed) return null;
  // javascript: 等の非 http(s) スキーム callbackURL は invitation 文脈として扱わない (不正値を無視)。
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.searchParams.get("invitation_token");
}

function safeParseUrl(value: string): URL | null {
  // URL.canParse で事前判定し synchronous throw (try-catch) を避ける。
  return URL.canParse(value, "http://localhost") ? new URL(value, "http://localhost") : null;
}
