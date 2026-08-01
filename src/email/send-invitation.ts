import { isLocalEnvironment } from "../env";
import {
  getAbuseInfoUrl,
  getAppName,
  getInvitationFromEmail,
  getSupportEmail,
  renderAndSendEmail,
} from "./client";
import InvitationEmail from "./invitation";
import { sanitizeDisplayText } from "./sanitize";

export type InvitationEmailParams = {
  inviteeEmail: string;
  url: string;
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  roleLabel: string;
};

// 招待メール送信。local は console.log fallback (Magic Link / Welcome と同パターン)。
export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  if (isLocalEnvironment()) {
    console.log(`[TEST] Invitation email for ${params.inviteeEmail}: ${params.url}`);
    return;
  }

  const appName = getAppName();
  // 件名は SMTP ヘッダに入るため CR/LF を含む user 入力 (inviter/company 名) を sanitize し
  // ヘッダインジェクションを防ぐ。
  const subjectInviter = sanitizeDisplayText(params.inviterName);
  const subjectCompany = sanitizeDisplayText(params.companyName);
  await renderAndSendEmail({
    from: getInvitationFromEmail(),
    to: params.inviteeEmail,
    subject: `[${appName}] ${subjectInviter} さんから「${subjectCompany}」への招待`,
    component: InvitationEmail({
      url: params.url,
      appName,
      companyName: params.companyName,
      inviterName: params.inviterName,
      inviterEmail: params.inviterEmail,
      inviteeEmail: params.inviteeEmail,
      roleLabel: params.roleLabel,
      supportEmail: getSupportEmail(),
      abuseUrl: getAbuseInfoUrl(),
    }),
    kind: "invitation",
  });
}

export function roleLabel(role: "OWNER" | "ADMIN" | "MEMBER"): string {
  switch (role) {
    case "OWNER":
      return "オーナー";
    case "ADMIN":
      return "管理者";
    default:
      return "メンバー";
  }
}
