import { afterAll, beforeAll } from "bun:test";
import { type CaptureContext, consoleSentryBackend, setSentryBackend } from "../sentry";

// Sentry backend は module 全体で共有される。install したテストファイルは必ず既定 (consoleSentryBackend) へ戻し、
// 後続のファイルに spy を残さない。

// adapter や guard の観測用。captureException の呼び出しを [error, context] のまま溜める (cause の同一性を保つ)。
// install と restore は beforeAll と afterAll で行うので、呼び出し側は返った配列を読むだけでよい。
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

// MFA の失敗経路は「握り潰さず観測へ回す」ことが仕様の一部なので、captureMessage と captureException の
// 呼び出しはテストの検証対象になる。こちらは install、reset、restore のタイミングを呼び出し側が決める版。
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
