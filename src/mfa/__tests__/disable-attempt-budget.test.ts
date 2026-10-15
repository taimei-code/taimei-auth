import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { TtlStore } from "../../ttl-store-service";
import { TtlStoreError } from "../../errors";
import { partial } from "../../__tests__/live-runner";
import { SentryLive } from "../../sentry";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "../../__tests__/test-layers";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { Locked } from "../errors";

describe("spendDisableAttempt", () => {
  const { exceptions: captured } = recordSentry();
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

describe("resetDisableAttempts", () => {
  const ttlStoreFailingDelete = Layer.succeed(
    TtlStore,
    partial<TtlStore["Service"]>({
      delete: () => Effect.fail(new TtlStoreError({ cause: new Error("test: delete failed") })),
    }),
  );
  const { exceptions: captured } = recordSentry();

  test("消し損ねは失敗にせず Sentry に残す (counter は TTL で消え、次の枠が狭いままになるだけ)", async () => {
    const before = captured.length;
    await expect(
      Effect.runPromise(
        Effect.provide(
          resetDisableAttempts("user-1"),
          Layer.mergeAll(ttlStoreFailingDelete, SentryLive),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(captured.length).toBe(before + 1);
  });
});
