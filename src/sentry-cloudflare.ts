// Workers entry (src/worker.ts) 専用。@sentry/cloudflare の capture を Sentry facade に注入する。
// worker.ts が export default を Sentry.withSentry でラップしリクエストスコープで client を
// 初期化するため、本 backend の captureException は handler 実行中 (withSentry スコープ内) に呼ばれる。
// 本 module は Workers entry からのみ import され Bun バンドルには含まれない (sentry-bun.ts と対)。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
import * as SentryCloudflare from "@sentry/cloudflare";
import { setSentryBackend, type CaptureContext } from "./sentry";

export function initCloudflareSentry(dsn?: string): void {
  // DSN 無しなら backend を差し替えず console fallback を残す (差し替えると未初期化の SDK に委譲し
  // 例外を黙って捨てるため。sentry-bun.ts と同方針)。
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
