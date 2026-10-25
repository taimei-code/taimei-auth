import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  captureCauseAs,
  consoleSentryBackend,
  SentryLive,
  SentryService,
  setSentryBackend,
} from "../../src/sentry";
import { captureThrown } from "../../src/handlers/client-facing-error";
import { initBunSentry } from "../sentry-bun";
import { grepFiles } from "../../src/__tests__/source-scan";
import { recordSentry } from "../../src/__tests__/sentry-recorder";

describe("captureCauseAs", () => {
  const { exceptions: captured } = recordSentry();
  const run = <A>(program: Effect.Effect<A, never, SentryService>) =>
    Effect.runPromise(Effect.exit(program).pipe(Effect.provide(SentryLive)));

  test("cause を warning + tags で記録してから渡した値で成功する", async () => {
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

  test("context の level は既定の warning を上書きする", async () => {
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

test("Sentry の SDK を import するのは runtime ごとの初期化 file と worker.ts だけ (共通の sentry.ts から import すると Workers の bundle に @sentry/bun が混ざる)", () => {
  expect(grepFiles('from "@sentry/', ["src", "testing"], { tests: "exclude" }).sort()).toEqual([
    "src/sentry-cloudflare.ts",
    "src/worker.ts",
    "testing/sentry-bun.ts",
  ]);
});

describe("captureThrown は観測自体の失敗を握る", () => {
  const sentryFailure = new Error("sentry down");
  beforeAll(() =>
    setSentryBackend({
      captureException: () => {
        throw sentryFailure;
      },
      captureMessage: () => {},
    }),
  );
  afterAll(() => setSentryBackend(consoleSentryBackend));

  test("backend が throw しても captureThrown は throw せず、元の error と観測失敗を console.error に残す", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const original = new Error("x");
      expect(() => captureThrown(original, "better-auth")).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0]).toEqual(["[better-auth]", original]);
      expect(spy.mock.calls[1]?.[1]).toBe(sentryFailure);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("initBunSentry", () => {
  test("SENTRY_DSN が無いと SDK に差し替えず console の記録を残す (DSN 無しで初期化した SDK は例外を捨てる)", () => {
    const originalDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      initBunSentry();

      expect(warn.mock.calls.map(([message]) => message)).toContain(
        "[sentry] SENTRY_DSN is not set, using console fallback",
      );
    } finally {
      warn.mockRestore();
      if (originalDsn !== undefined) process.env.SENTRY_DSN = originalDsn;
    }
  });
});
