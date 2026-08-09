import type { ReactElement } from "react";
import { isLocalEnvironment } from "../env";
import {
  getAppName,
  getAppUrl,
  getSecurityFromEmail,
  getSupportEmail,
  renderAndSendEmail,
} from "./client";
import MfaDisabledEmail from "./mfa-disabled";
import MfaEnabledEmail from "./mfa-enabled";

const SECURITY_PAGE_PATH = "/account/security";

async function sendMfaNotification(params: {
  email: string;
  subject: string;
  render: (props: { appName: string; securityUrl: string; supportEmail: string }) => ReactElement;
  kind: "mfa enabled" | "mfa disabled";
}): Promise<void> {
  if (isLocalEnvironment()) {
    console.log(`[TEST] ${params.kind} email for ${params.email}`);
    return;
  }

  const appName = getAppName();
  await renderAndSendEmail({
    from: getSecurityFromEmail(),
    to: params.email,
    subject: `[${appName}] ${params.subject}`,
    component: params.render({
      appName,
      securityUrl: `${getAppUrl()}${SECURITY_PAGE_PATH}`,
      supportEmail: getSupportEmail(),
    }),
    kind: params.kind,
  });
}

export function sendMfaEnabledEmail(email: string): Promise<void> {
  return sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を有効にしました",
    render: MfaEnabledEmail,
    kind: "mfa enabled",
  });
}

export function sendMfaDisabledEmail(email: string): Promise<void> {
  return sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を無効にしました",
    render: MfaDisabledEmail,
    kind: "mfa disabled",
  });
}
