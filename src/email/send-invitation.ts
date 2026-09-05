import { Effect } from "effect";
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
export const sendInvitationEmail = Effect.fn("email.sendInvitation")(function* (
  params: InvitationEmailParams,
) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() =>
      console.log(`[TEST] Invitation email for ${params.inviteeEmail}: ${params.url}`),
    );
    return;
  }

  const appName = getAppName();
  // 件名は SMTP ヘッダに入るため CR/LF を含む user 入力を sanitize しヘッダインジェクションを防ぐ。
  const headerSafeInviterName = sanitizeDisplayText(params.inviterName);
  const headerSafeCompanyName = sanitizeDisplayText(params.companyName);
  yield* renderAndSendEmail({
    from: getInvitationFromEmail(),
    to: params.inviteeEmail,
    subject: `[${appName}] ${headerSafeInviterName} さんから「${headerSafeCompanyName}」への招待`,
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
});
