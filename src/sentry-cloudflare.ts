import * as SentryCloudflare from "@sentry/cloudflare";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initCloudflareSentry(dsn?: string): void {
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set, using console fallback");
    return;
  }
  setSentryBackend({
    captureException: (error, context?: CaptureContext) =>
      SentryCloudflare.captureException(error, context as never),
    captureMessage: (message, context?: CaptureContext) =>
      SentryCloudflare.captureMessage(message, context as never),
  });
}
