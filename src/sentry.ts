import { Context, Effect, Layer } from "effect";
// SDK への依存をここに持たせないのは、Workers のバンドルに @sentry/bun が混入するのを防ぐため。
export type CaptureContext = {
  level?: "fatal" | "error" | "warning" | "info" | "debug";
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
};

export interface SentryBackend {
  captureException(error: unknown, context?: CaptureContext): void;
  captureMessage(message: string, context?: CaptureContext): void;
}

export const consoleSentryBackend: SentryBackend = {
  captureException: (error) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message, context) =>
    console.warn("[sentry:noop] captureMessage", message, context?.tags),
};

let backend: SentryBackend = consoleSentryBackend;

export function setSentryBackend(next: SentryBackend): void {
  backend = next;
}

export const Sentry = {
  captureException: (error: unknown, context?: CaptureContext): void =>
    backend.captureException(error, context),
  captureMessage: (message: string, context?: CaptureContext): void =>
    backend.captureMessage(message, context),
};

export class SentryService extends Context.Service<
  SentryService,
  {
    captureException(error: unknown, context?: CaptureContext): Effect.Effect<void>;
    captureMessage(message: string, context?: CaptureContext): Effect.Effect<void>;
  }
>()("taimei/Sentry") {}

export const captureCause =
  (context?: CaptureContext) =>
  (failure: { readonly cause: unknown }): Effect.Effect<void, never, SentryService> =>
    SentryService.use((sentry) =>
      sentry.captureException(failure.cause, { level: "warning", ...context }),
    );

export const captureCauseAs =
  <A>(value: A, context?: CaptureContext) =>
  (failure: { readonly cause: unknown }): Effect.Effect<A, never, SentryService> =>
    captureCause(context)(failure).pipe(Effect.as(value));

const bestEffort = (send: () => void): Effect.Effect<void> =>
  Effect.sync(send).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => console.error("[sentry] capture failed", defect)),
    ),
  );

export const SentryLive = Layer.succeed(
  SentryService,
  SentryService.of({
    captureException: (error, context) => bestEffort(() => Sentry.captureException(error, context)),
    captureMessage: (message, context) => bestEffort(() => Sentry.captureMessage(message, context)),
  }),
);
