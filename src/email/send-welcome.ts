import { render } from "@react-email/components";
import { isLocalEnvironment } from "../env";
import { getAppName, getAppUrl, getResendClient, getWelcomeFromEmail } from "./client";
import WelcomeEmail from "./welcome";

export async function sendWelcomeEmail(email: string, userName?: string | null): Promise<void> {
  if (isLocalEnvironment()) {
    console.log(`[TEST] Welcome email for ${email}`);
    return;
  }

  const resend = getResendClient();
  const fromEmail = getWelcomeFromEmail();
  const appName = getAppName();
  const dashboardUrl = `${getAppUrl()}/dashboard`;

  const emailComponent = WelcomeEmail({ appName, userName, dashboardUrl });
  const html = await render(emailComponent);
  const text = await render(emailComponent, { plainText: true });

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `${appName} へようこそ！`,
    html,
    text,
  });

  if (error) {
    console.error("Failed to send welcome email:", error);
    throw new Error(`Email sending failed: ${error.message}`);
  }
}
