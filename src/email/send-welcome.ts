import { Effect } from "effect";
import { isLocalEnvironment } from "../env";
import { getAppName, getAppUrl, getWelcomeFromEmail, renderAndSendEmail } from "./client";
import type { DisplayText } from "./sanitize";
import WelcomeEmail from "./welcome";

export const sendWelcomeEmail = Effect.fn("email.sendWelcome")(function* (
  email: string,
  userName: DisplayText,
) {
  if (isLocalEnvironment()) {
    yield* Effect.sync(() => console.log(`[TEST] Welcome email for ${email}`));
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
