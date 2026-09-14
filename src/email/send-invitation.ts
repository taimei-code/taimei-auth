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
import type { DisplayText } from "./sanitize";

export type InvitationEmailParams = {
  inviteeEmail: string;
  url: string;
  companyName: DisplayText;
  inviterName: DisplayText;
  inviterEmail: DisplayText;
  roleLabel: string;
};

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
  yield* renderAndSendEmail({
    from: getInvitationFromEmail(),
    to: params.inviteeEmail,
    subject: `[${appName}] ${params.inviterName} さんから「${params.companyName}」への招待`,
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
