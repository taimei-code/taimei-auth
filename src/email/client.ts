import type { ReactElement } from "react";
import { Resend } from "resend";

let resendInstance: Resend | null = null;

// 全メールが同じ render → send → error 変換を辿るためここに閉じ、送信基盤の差し替え点を 1 箇所にする。
export async function renderAndSendEmail(params: {
  from: string;
  to: string;
  subject: string;
  component: ReactElement;
  kind: "magic link" | "welcome" | "invitation" | "mfa enabled" | "mfa disabled";
}): Promise<void> {
  // render は workerd バンドルで esbuild の lazy CJS init が走らず undefined になるため、dynamic import で
  // module init を強制する (ADR-0011)。実行時に react を引くので react / react-dom は devDependencies へ移さない。
  const { render } = await import("@react-email/components");
  const [html, text] = await Promise.all([
    render(params.component),
    render(params.component, { plainText: true }),
  ]);

  const { error } = await getResendClient().emails.send({
    from: params.from,
    to: params.to,
    subject: params.subject,
    html,
    text,
  });

  if (error) {
    console.error(`Failed to send ${params.kind} email:`, error);
    throw new Error(`Email sending failed: ${error.message}`);
  }
}

export function getResendClient(): Resend {
  if (!resendInstance) {
    const apiKey = process.env.AUTH_RESEND_KEY;

    if (!apiKey) {
      throw new Error("AUTH_RESEND_KEY is not configured. Please set it in .env file.");
    }

    resendInstance = new Resend(apiKey);
  }

  return resendInstance;
}

export function getWelcomeFromEmail(): string {
  return process.env.AUTH_FROM_EMAIL_WELCOME || "onboarding@resend.dev";
}

export function getMagicLinkFromEmail(): string {
  return process.env.AUTH_FROM_EMAIL_MAGIC_LINK || "onboarding@resend.dev";
}

export function getInvitationFromEmail(): string {
  return process.env.AUTH_FROM_EMAIL_INVITATION || "onboarding@resend.dev";
}

export function getSecurityFromEmail(): string {
  return process.env.AUTH_FROM_EMAIL_SECURITY || "onboarding@resend.dev";
}

export function getSupportEmail(): string {
  return process.env.AUTH_SUPPORT_EMAIL || "support@taimei-code.com";
}

export function getAbuseInfoUrl(): string {
  return process.env.AUTH_ABUSE_INFO_URL || "https://taimei-code.com/security";
}

export function getAppName(): string {
  return process.env.APP_NAME || "taimei";
}

export function getAppUrl(): string {
  return process.env.AUTH_SERVICE_URL || "http://localhost:3100";
}
