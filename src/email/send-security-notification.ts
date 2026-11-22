import { Effect } from "effect";
import {
  getAppName,
  getAppUrl,
  getSecurityFromEmail,
  getSupportEmail,
  type EmailKind,
  renderAndSendEmail,
} from "./client";
import type { EmailBody } from "./layout";
import { mfaDisabledEmail } from "./mfa-disabled";
import { mfaEnabledEmail } from "./mfa-enabled";
import { type PasskeyChangedEmailParams, passkeyChangedEmail } from "./passkey-changed";

const SECURITY_PAGE_PATH = "/account/security";

const sendSecurityNotification = Effect.fnUntraced(function* (params: {
  email: string;
  buildBody: (props: { appName: string; securityUrl: string; supportEmail: string }) => EmailBody;
  kind: EmailKind;
}) {
  const appName = getAppName();
  const body = params.buildBody({
    appName,
    securityUrl: `${getAppUrl()}${SECURITY_PAGE_PATH}`,
    supportEmail: getSupportEmail(),
  });
  yield* renderAndSendEmail({
    from: getSecurityFromEmail(),
    to: params.email,
    subject: `[${appName}] ${body.title}`,
    body,
    kind: params.kind,
  });
});

export const sendMfaEnabledEmail = (email: string) =>
  sendSecurityNotification({ email, buildBody: mfaEnabledEmail, kind: "mfa enabled" });

export const sendMfaDisabledEmail = (email: string) =>
  sendSecurityNotification({ email, buildBody: mfaDisabledEmail, kind: "mfa disabled" });

export const sendPasskeyChangedEmail = ({ email, ...detail }: PasskeyChangedEmailParams) =>
  sendSecurityNotification({
    email,
    buildBody: (props) => passkeyChangedEmail({ ...props, ...detail }),
    kind: `passkey ${detail.change}`,
  });
