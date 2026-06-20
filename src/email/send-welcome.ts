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
  // render は dynamic import で実行時 init を強制 (workerd バンドルの lazy CJS init 回避)。
  // 詳細: docs/adr/0011-cloudflare-workers-migration.md
  const { render } = await import("@react-email/components");
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
