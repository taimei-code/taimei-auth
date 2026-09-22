import { afterAll, beforeAll } from "bun:test";
import { type CaptureContext, consoleSentryBackend, setSentryBackend } from "../sentry";

export function recordSentryExceptions(): Array<[unknown, CaptureContext | undefined]> {
  const captured: Array<[unknown, CaptureContext | undefined]> = [];
  beforeAll(() => {
    setSentryBackend({
      captureException: (error, context) => {
        captured.push([error, context]);
      },
      captureMessage: () => {},
    });
  });
  afterAll(() => setSentryBackend(consoleSentryBackend));
  return captured;
}

export type SentryCapture = { message: string; context?: CaptureContext };

export function installSentryRecorder(): {
  messages: SentryCapture[];
  exceptions: SentryCapture[];
  reset(): void;
  restore(): void;
} {
  const messages: SentryCapture[] = [];
  const exceptions: SentryCapture[] = [];
  setSentryBackend({
    captureMessage: (message, context) => messages.push({ message, context }),
    captureException: (error, context) => exceptions.push({ message: String(error), context }),
  });
  return {
    messages,
    exceptions,
    reset: () => {
      messages.length = 0;
      exceptions.length = 0;
    },
    restore: () => setSentryBackend(consoleSentryBackend),
  };
}
