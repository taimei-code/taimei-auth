import { Effect } from "effect";
import { isLocalEnvironment } from "../env";
import { getAppName, getAppUrl, getWelcomeFromEmail, renderAndSendEmail } from "./client";
import { WELCOME_EMAIL_LOG } from "./local-delivery-log";
import type { DisplayText } from "./sanitize";
import WelcomeEmail from "./welcome";

export const sendWelcomeEmail = Effect.fnUntraced(function* (email: string, userName: DisplayText) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() => console.log(`${WELCOME_EMAIL_LOG} ${email}`));
    return;
  }

  const appName = getAppName();
  yield* renderAndSendEmail({
    from: getWelcomeFromEmail(),
    to: email,
    subject: `${appName} へようこそ！`,
    component: WelcomeEmail({ appName, userName, dashboardUrl: `${getAppUrl()}/dashboard` }),
    kind: "welcome",
  });
});
