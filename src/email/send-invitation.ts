import { isLocalEnvironment } from "../env";
import { ROLE_LABELS_JA } from "../membership/role-label";
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

// invitation.role は DB text の生値が届くため、未知値 (prototype 上のキー名含む) は
// Object.hasOwn で弾き「メンバー」に倒す (現行挙動の踏襲。SPA 側は素の値を返す — role-label.ts 参照)。
export function roleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABELS_JA, role)
    ? ROLE_LABELS_JA[role as keyof typeof ROLE_LABELS_JA]
    : "メンバー";
}
