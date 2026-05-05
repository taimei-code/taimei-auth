import { Resend } from "resend";

let resendInstance: Resend | null = null;

export function isLocalEnvironment(): boolean {
  return process.env.APP_ENV !== "production";
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

export function getAppName(): string {
  return process.env.APP_NAME || "taimei";
}

export function getAppUrl(): string {
  return process.env.AUTH_SERVICE_URL || "http://localhost:3100";
}
