import { Effect } from "effect";
import { getAppName, getAppUrl, getWelcomeFromEmail, renderAndSendEmail } from "./client";
import type { DisplayText } from "./sanitize";
import WelcomeEmail from "./welcome";

export const sendWelcomeEmail = Effect.fnUntraced(function* (email: string, userName: DisplayText) {
  const appName = getAppName();
  yield* renderAndSendEmail({
    from: getWelcomeFromEmail(),
    to: email,
    subject: `${appName} へようこそ！`,
    component: WelcomeEmail({ appName, userName, dashboardUrl: `${getAppUrl()}/dashboard` }),
    kind: "welcome",
  });
});
