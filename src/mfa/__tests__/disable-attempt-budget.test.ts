import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { TtlStore } from "../../ttl-store-service";
import { SentryLive } from "../../sentry";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "../../__tests__/test-layers";
import { spendDisableAttempt } from "../disable-attempt-budget";
import { Locked } from "../error-mapping";

// 無効化の試行枠の倒し方 (fail-closed) を TTL store 無しで固定する。exhausted の 429 は
// handlers/__tests__/account-mfa.test.ts (QA-M-09) が live で見るので、ここは kernel の verdict → Locked の写像だけ。
// 正本: CONTEXT.md「fail-closed / fail-open」→ ADR-0013 Consequences → ADR-0016。
describe("spendDisableAttempt", () => {
  const captured = recordSentryExceptions();
  const spend = (ttlStore: Layer.Layer<TtlStore>) =>
    Effect.runPromise(
      Effect.provide(
        Effect.flip(spendDisableAttempt("user-1")),
        Layer.mergeAll(ttlStore, SentryLive),
      ),
    );

  test("計数不能 (unavailable) は fail-closed で Locked に倒し、Sentry に component 付きで 1 回記録する", async () => {
    const before = captured.length;
    expect(await spend(failingTtlStoreLayer)).toBeInstanceOf(Locked);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("mfa-disable-attempt-budget");
  });

  test("上限超過 (exhausted) も Locked", async () => {
    expect(await spend(ttlStoreReturning({ count: 6 }))).toBeInstanceOf(Locked);
  });

  test("上限ちょうど (accepted) は通す", async () => {
    await expect(
      Effect.runPromise(
        Effect.provide(
          spendDisableAttempt("user-1"),
          Layer.mergeAll(ttlStoreReturning({ count: 5 }), SentryLive),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
