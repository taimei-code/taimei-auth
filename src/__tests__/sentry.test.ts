import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  captureCauseAs,
  consoleSentryBackend,
  SentryLive,
  SentryService,
  setSentryBackend,
} from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";

describe("captureCauseAs", () => {
  const captured = recordSentryExceptions();
  const run = <A>(program: Effect.Effect<A, never, SentryService>) =>
    Effect.runPromise(Effect.exit(program).pipe(Effect.provide(SentryLive)));

  test("AC-001/002/004 cause を warning + tags で記録してから渡した値で成功する", async () => {
    const cause = new Error("boom");
    const value = { marker: true };
    const before = captured.length;
    const exit = await run(captureCauseAs(value, { tags: { t: "1" } })({ cause }));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) throw new Error();
    expect(exit.value).toBe(value);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({ level: "warning", tags: { t: "1" } });
  });

  test("AC-003/004 context の level は既定の warning を上書きする", async () => {
    const exit = await run(
      captureCauseAs(null, { level: "error", tags: { t: "2" } })({ cause: 1 }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(captured.at(-1)?.[1]?.level).toBe("error");
  });
});

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
