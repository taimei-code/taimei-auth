import { Effect } from "effect";
import {
  getAppName,
  getAppUrl,
  getSecurityFromEmail,
  getSupportEmail,
  renderAndSendEmail,
} from "./client";
import type { EmailBody } from "./layout";
import { mfaDisabledEmail } from "./mfa-disabled";
import { mfaEnabledEmail } from "./mfa-enabled";

const SECURITY_PAGE_PATH = "/account/security";

const sendMfaNotification = Effect.fnUntraced(function* (params: {
  email: string;
  subject: string;
  buildBody: (props: { appName: string; securityUrl: string; supportEmail: string }) => EmailBody;
  kind: "mfa enabled" | "mfa disabled";
}) {
  const appName = getAppName();
  yield* renderAndSendEmail({
    from: getSecurityFromEmail(),
    to: params.email,
    subject: `[${appName}] ${params.subject}`,
    body: params.buildBody({
      appName,
      securityUrl: `${getAppUrl()}${SECURITY_PAGE_PATH}`,
      supportEmail: getSupportEmail(),
    }),
    kind: params.kind,
  });
});

export const sendMfaEnabledEmail = (email: string) =>
  sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を有効にしました",
    buildBody: mfaEnabledEmail,
    kind: "mfa enabled",
  });

export const sendMfaDisabledEmail = (email: string) =>
  sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を無効にしました",
    buildBody: mfaDisabledEmail,
    kind: "mfa disabled",
  });
