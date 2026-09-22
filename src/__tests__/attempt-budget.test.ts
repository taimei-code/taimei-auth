import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { spendAttemptBudget } from "../attempt-budget";
import type { TtlStore } from "../ttl-store-service";
import { SentryLive } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "./test-layers";

// 試行枠 kernel (設計 AC-017〜AC-021) のテスト。数えられない時に unavailable として扱う挙動と上限の境界を、TTL store 無しで観測する。
// TTL store の stub と Sentry だけで観測できるので、DB を要求する runTest は使わない。
describe("spendAttemptBudget", () => {
  const captured = recordSentryExceptions();
  const spend = (ttlStore: Layer.Layer<TtlStore>, maxAttempts = 5) =>
    Effect.runPromise(
      Effect.provide(
        spendAttemptBudget({
          key: "attempt-budget-test",
          windowSeconds: 60,
          maxAttempts,
          component: "c",
        }),
        Layer.mergeAll(ttlStore, SentryLive),
      ),
    );

  test("AC-017 / AC-018 計数不能 (TtlStoreError) は unavailable に倒し、Sentry に component 付き warning で 1 回記録する", async () => {
    const before = captured.length;
    expect(await spend(failingTtlStoreLayer)).toBe("unavailable");
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
    // 境界のエラーは warning にする (ADR-0017 Decision の Sentry 項)。level は呼び出し側で変えない。
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("AC-019 count 0 は契約逸脱として unavailable に倒す (fail-closed の第 2 線)", async () => {
    expect(await spend(ttlStoreReturning({ count: 0 }))).toBe("unavailable");
  });

  test("AC-020 count が上限ちょうどなら accepted", async () => {
    expect(await spend(ttlStoreReturning({ count: 5 }), 5)).toBe("accepted");
  });

  test("AC-021 count が上限を 1 超えたら exhausted", async () => {
    expect(await spend(ttlStoreReturning({ count: 6 }), 5)).toBe("exhausted");
  });
});
