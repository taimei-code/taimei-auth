// Bun entry (src/index.ts) 専用。@sentry/bun を初期化し Sentry facade に backend を注入する。
// 本 module は Bun entry からのみ import され、Workers バンドルには含まれない。
import * as SentryBun from "@sentry/bun";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initBunSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  // DSN 無しなら backend を差し替えず、sentry.ts の console fallback をそのまま残す
  // (差し替えると未初期化の @sentry/bun に委譲し例外を黙って捨てるため)。
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
