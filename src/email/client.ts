import { Resend } from "resend";

let resendInstance: Resend | null = null;

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
