import { describe, expect, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import {
  AttemptBudgetExhausted,
  AttemptBudgetUnavailable,
  spendAttemptBudgetFailClosed,
  spendAttemptBudgetFailOpen,
} from "../attempt-budget";
import type { TtlStore } from "../ttl-store-service";
import { SentryLive, type SentryService } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "./test-layers";

type BudgetInput = Parameters<typeof spendAttemptBudgetFailOpen>[0];

spendAttemptBudgetFailOpen satisfies (
  input: BudgetInput,
) => Effect.Effect<void, AttemptBudgetExhausted, TtlStore | SentryService>;
spendAttemptBudgetFailClosed satisfies (
  input: BudgetInput,
) => Effect.Effect<
  void,
  AttemptBudgetExhausted | AttemptBudgetUnavailable,
  TtlStore | SentryService
>;

const input = { key: "attempt-budget-test", windowSeconds: 60, maxAttempts: 5, component: "c" };

const resultOf = (
  program: Effect.Effect<
    void,
    AttemptBudgetExhausted | AttemptBudgetUnavailable,
    TtlStore | SentryService
  >,
  ttlStore: Layer.Layer<TtlStore>,
) =>
  Effect.runPromise(
    Effect.result(program).pipe(Effect.provide(Layer.mergeAll(ttlStore, SentryLive))),
  );

describe.each([
  [
    "spendAttemptBudgetFailClosed",
    spendAttemptBudgetFailClosed,
    Result.fail(new AttemptBudgetUnavailable()),
  ],
  ["spendAttemptBudgetFailOpen", spendAttemptBudgetFailOpen, Result.succeed(undefined)],
] as const)("%s", (_, spend, whenUncountable) => {
  const captured = recordSentryExceptions();

  test("計数不能 (TtlStoreError) は fail-closed なら拒否、fail-open なら通し、Sentry に component 付き warning で 1 回記録する", async () => {
    const before = captured.length;
    expect(await resultOf(spend(input), failingTtlStoreLayer)).toEqual(whenUncountable);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("TTL store が契約に外れた count 0 を返しても (ttl-store.ts の toRateWindowResult が throw し損ねた場合)、計数不能と同じ扱いになり、Sentry に component 付き warning で 1 回記録する", async () => {
    const before = captured.length;
    expect(await resultOf(spend(input), ttlStoreReturning({ count: 0 }))).toEqual(whenUncountable);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("count が上限ちょうどなら通す", async () => {
    expect(await resultOf(spend(input), ttlStoreReturning({ count: 5 }))).toEqual(
      Result.succeed(undefined),
    );
  });

  test("count が上限を 1 超えたら AttemptBudgetExhausted", async () => {
    expect(await resultOf(spend(input), ttlStoreReturning({ count: 6 }))).toEqual(
      Result.fail(new AttemptBudgetExhausted()),
    );
  });
});
