import { afterAll, beforeAll } from "bun:test";
import { type CaptureContext, consoleSentryBackend, setSentryBackend } from "../sentry";

export type SentryMessage = { message: string; context?: CaptureContext };

export function recordSentry(): {
  exceptions: Array<[unknown, CaptureContext | undefined]>;
  messages: SentryMessage[];
  reset(): void;
} {
  const exceptions: Array<[unknown, CaptureContext | undefined]> = [];
  const messages: SentryMessage[] = [];
  beforeAll(() => {
    setSentryBackend({
      captureException: (error, context) => {
        exceptions.push([error, context]);
      },
      captureMessage: (message, context) => {
        messages.push({ message, context });
      },
    });
  });
  afterAll(() => setSentryBackend(consoleSentryBackend));
  return {
    exceptions,
    messages,
    reset: () => {
      exceptions.length = 0;
      messages.length = 0;
    },
  };
}
