import { findCompanyById } from "@/db/repositories/company";
import { findInvitationByToken } from "@/db/repositories/invitation";
import { findUserById } from "@/db/repositories/user";
import { roleLabelJa } from "../membership/role-label";

export type InvitationEmailContext = {
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  roleLabel: string;
};

// callbackURL に invitation_token が載っていれば招待メール描画に必要な company / inviter を解決する。
// sendMagicLink callback は {email, url} しか受け取らないため url から context を再構成する。
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
    // 招待メールでは未知 role を「メンバー」に倒す (SPA は素の値を出す — 用途別 fallback)。
    roleLabel: roleLabelJa(invitation.role, "メンバー"),
  };
}

function extractInvitationToken(magicLinkUrl: string): string | null {
  const callback = safeParseUrl(magicLinkUrl)?.searchParams.get("callbackURL");
  if (!callback) return null;
  // callbackURL は相対 / 絶対どちらもあり得る。
  const parsed = safeParseUrl(callback);
  if (!parsed) return null;
  // javascript: 等の非 http(s) スキーム callbackURL は invitation 文脈として扱わない (不正値を無視)。
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.searchParams.get("invitation_token");
}

const RELATIVE_URL_BASE = "http://localhost";

function safeParseUrl(value: string): URL | null {
  // URL.canParse で事前判定し synchronous throw (try-catch) を避ける。
  return URL.canParse(value, RELATIVE_URL_BASE) ? new URL(value, RELATIVE_URL_BASE) : null;
}
