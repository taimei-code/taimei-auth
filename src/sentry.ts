// runtime 非依存の Sentry facade。実 backend は各 entry が setSentryBackend で注入する。本 module に
// SDK 依存を持たせないことで Workers バンドルへの @sentry/bun 混入を防ぐ (詳細: ADR-0011)。
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
