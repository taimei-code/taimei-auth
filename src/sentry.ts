import { Context, Effect, Layer } from "effect";
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

type SentryEventRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: unknown;
  cookies?: unknown;
  query_string?: unknown;
};

export type SentryEvent = { message?: string; request?: SentryEventRequest };

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "content-length",
  "content-type",
  "user-agent",
]);

const urlWithoutQuery = (url: string): string => {
  if (!URL.canParse(url)) return "[unparsable url]";
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

export const withoutRequestSecrets = <E extends SentryEvent>(event: E): E => {
  const { request } = event;
  if (!request) return event;
  return {
    ...event,
    request: {
      method: request.method,
      url: request.url === undefined ? undefined : urlWithoutQuery(request.url),
      headers: Object.fromEntries(
        Object.entries(request.headers ?? {}).filter(([name]) =>
          FORWARDED_REQUEST_HEADERS.has(name.toLowerCase()),
        ),
      ),
    },
  };
};

export const SENTRY_REQUEST_PRIVACY = {
  sendDefaultPii: false,
  beforeSend: withoutRequestSecrets,
  beforeSendTransaction: withoutRequestSecrets,
} as const;

export const SentryLive = Layer.succeed(
  SentryService,
  SentryService.of({
    captureException: (error, context) => bestEffort(() => Sentry.captureException(error, context)),
    captureMessage: (message, context) => bestEffort(() => Sentry.captureMessage(message, context)),
  }),
);
