// Workers entry 専用。@sentry/cloudflare の capture を Sentry facade に注入する。Workers entry からのみ
// import され Bun バンドルには含まれない (sentry-bun.ts と対)。詳細: ADR-0011
import * as SentryCloudflare from "@sentry/cloudflare";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initCloudflareSentry(dsn?: string): void {
  // DSN 無しなら backend を差し替えず console fallback を残す (差し替えると未初期化 SDK が例外を黙って捨てる)。
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
