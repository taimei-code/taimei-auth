import * as SentryCloudflare from "@sentry/cloudflare";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initCloudflareSentry(dsn?: string): void {
  // DSN 無しで差し替えると未初期化の SDK が例外を捨てるため、console fallback を残す。
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
