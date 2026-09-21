import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { consoleSentryBackend, SentryLive, SentryService, setSentryBackend } from "../sentry";

describe("SentryLive", () => {
  const originalError = console.error;
  const logged: unknown[][] = [];
  beforeAll(() => {
    setSentryBackend({
      captureException: () => {
        throw new Error("sdk broken");
      },
      captureMessage: () => {
        throw new Error("sdk broken");
      },
    });
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
  });
  afterAll(() => {
    setSentryBackend(consoleSentryBackend);
    console.error = originalError;
  });

  test("backend が throw しても captureException / captureMessage は成功で終わる (観測が業務を落とさない)", async () => {
    const exit = await Effect.runPromiseExit(
      SentryService.use((s) =>
        Effect.all([s.captureException(new Error("e")), s.captureMessage("m")]),
      ).pipe(Effect.provide(SentryLive)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(logged.length).toBe(2);
  });
});
