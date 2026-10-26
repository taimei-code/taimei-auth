import * as SentryBun from "@sentry/bun";
import { SENTRY_REQUEST_PRIVACY, setSentryBackend, type CaptureContext } from "../src/sentry";

export function initBunSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set, using console fallback");
    return;
  }
  SentryBun.init({
    ...SENTRY_REQUEST_PRIVACY,
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
