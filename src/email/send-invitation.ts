import { isLocalEnvironment } from "../env";
import {
  getAbuseInfoUrl,
  getAppName,
  getInvitationFromEmail,
  getResendClient,
  getSupportEmail,
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

  const resend = getResendClient();
  const appName = getAppName();
  const emailComponent = InvitationEmail({
    url: params.url,
    appName,
    companyName: params.companyName,
    inviterName: params.inviterName,
    inviterEmail: params.inviterEmail,
    inviteeEmail: params.inviteeEmail,
    roleLabel: params.roleLabel,
    supportEmail: getSupportEmail(),
    abuseUrl: getAbuseInfoUrl(),
  });
  // render は dynamic import で実行時 init を強制 (workerd バンドルの lazy CJS init 回避)。
  // 詳細: docs/adr/0011-cloudflare-workers-migration.md
  const { render } = await import("@react-email/components");
  const html = await render(emailComponent);
  const text = await render(emailComponent, { plainText: true });

  // 件名は SMTP ヘッダに入るため CR/LF を含む user 入力 (inviter/company 名) を sanitize し
  // ヘッダインジェクションを防ぐ。
  const subjectInviter = sanitizeDisplayText(params.inviterName);
  const subjectCompany = sanitizeDisplayText(params.companyName);
  const { error } = await resend.emails.send({
    from: getInvitationFromEmail(),
    to: params.inviteeEmail,
    subject: `[${appName}] ${subjectInviter} さんから「${subjectCompany}」への招待`,
    html,
    text,
  });

  if (error) {
    console.error("Failed to send invitation email:", error);
    throw new Error(`Invitation email sending failed: ${error.message}`);
  }
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
