import { Effect } from "effect";
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

const sendMfaNotification = Effect.fn("email.sendMfaNotification")(function* (params: {
  email: string;
  subject: string;
  render: (props: { appName: string; securityUrl: string; supportEmail: string }) => ReactElement;
  kind: "mfa enabled" | "mfa disabled";
}) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() => console.log(`[TEST] ${params.kind} email for ${params.email}`));
    return;
  }

  const appName = getAppName();
  yield* renderAndSendEmail({
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
});

export const sendMfaEnabledEmail = (email: string) =>
  sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を有効にしました",
    render: MfaEnabledEmail,
    kind: "mfa enabled",
  });

export const sendMfaDisabledEmail = (email: string) =>
  sendMfaNotification({
    email,
    subject: "多要素認証 (MFA) を無効にしました",
    render: MfaDisabledEmail,
    kind: "mfa disabled",
  });
