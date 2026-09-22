import * as SentryBun from "@sentry/bun";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initBunSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  // DSN が無い状態で差し替えると未初期化の SDK が例外を捨ててしまうため、console への fallback を残す。
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
