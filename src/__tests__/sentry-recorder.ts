import { afterAll, beforeAll } from "bun:test";
import { type CaptureContext, consoleSentryBackend, setSentryBackend } from "../sentry";

// Sentry backend は module-global。install した test file は必ず既定 (consoleSentryBackend) へ戻し、
// 後続 file へ spy を漏らさない。

// adapter / guard の観測用: captureException を [error, context] のまま溜める (cause の identity を保つ)。
// install と restore を beforeAll / afterAll に載せるので、呼び出し側は返った配列を読むだけでよい。
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

// MFA の失敗経路は「握り潰さず観測へ回す」ことが仕様の一部なので、captureMessage / captureException の
// 発火はテストの検証対象になる。install / reset / restore の契機を呼び出し側が持つ版。
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
