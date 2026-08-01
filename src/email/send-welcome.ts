import { isLocalEnvironment } from "../env";
import { getAppName, getAppUrl, getWelcomeFromEmail, renderAndSendEmail } from "./client";
import WelcomeEmail from "./welcome";

export async function sendWelcomeEmail(email: string, userName?: string | null): Promise<void> {
  if (isLocalEnvironment()) {
    console.log(`[TEST] Welcome email for ${email}`);
    return;
  }

  const appName = getAppName();
  await renderAndSendEmail({
    from: getWelcomeFromEmail(),
    to: email,
    subject: `${appName} へようこそ！`,
    component: WelcomeEmail({ appName, userName, dashboardUrl: `${getAppUrl()}/dashboard` }),
    kind: "welcome",
  });
}
