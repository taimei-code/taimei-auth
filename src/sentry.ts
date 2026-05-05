import * as Sentry from "@sentry/bun";

// Sentry 初期化: SENTRY_DSN が設定されている時のみ initialize する。
// canary token 通報の主経路として使用 (Sentry.captureMessage)。
// 開発時 (DSN 未設定) は warn ログのみで Sentry 通信は行わない。
let initialized = false;

export const initSentry = (): void => {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set, Sentry will not be initialized");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
  initialized = true;
};

export { Sentry };
