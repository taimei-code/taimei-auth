// Bun entry 専用。@sentry/bun を初期化し facade に backend を注入する (Workers バンドルには含まれない)。
import * as SentryBun from "@sentry/bun";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initBunSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  // DSN 無しなら backend を差し替えず console fallback を残す (差し替えると未初期化 SDK が例外を黙って捨てる)。
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set, using console fallback");
    return;
  }
  SentryBun.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
  setSentryBackend({
    captureException: (error, context?: CaptureContext) =>
      SentryBun.captureException(error, context as never),
    captureMessage: (message, context?: CaptureContext) =>
      SentryBun.captureMessage(message, context as never),
  });
}
