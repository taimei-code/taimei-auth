// runtime 非依存の Sentry facade。
// 実 backend (Bun = @sentry/bun、Workers = @sentry/cloudflare) は各 entry が setSentryBackend で
// 注入する。handler 群が import する本 module に SDK 依存を持たせないことで、Workers バンドルに
// Bun 専用の @sentry/bun が混入するのを防ぐ。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
export type CaptureContext = {
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
};

export interface SentryBackend {
  captureException(error: unknown, context?: CaptureContext): void;
  captureMessage(message: string, context?: CaptureContext): void;
}

// backend 未注入時 (SENTRY_DSN 無し / Workers 未配線) は console fallback。
let backend: SentryBackend = {
  captureException: (error) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message, context) =>
    console.warn("[sentry:noop] captureMessage", message, context?.tags),
};

export function setSentryBackend(b: SentryBackend): void {
  backend = b;
}

export const Sentry = {
  captureException: (error: unknown, context?: CaptureContext): void =>
    backend.captureException(error, context),
  captureMessage: (message: string, context?: CaptureContext): void =>
    backend.captureMessage(message, context),
};
