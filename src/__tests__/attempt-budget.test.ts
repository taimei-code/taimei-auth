import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { spendAttemptBudget } from "../attempt-budget";
import type { Redis } from "../redis-service";
import { SentryLive } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";
import { failingRedisLayer, redisReturning } from "./test-layers";

// 試行枠 kernel (設計 AC-017〜AC-021)。数えられない時の unavailable への倒し方と上限の境界を Redis 無しで観測する。
// Redis stub と Sentry だけで観測できるので、DB を要求する runTest は使わない。
describe("spendAttemptBudget", () => {
  const captured = recordSentryExceptions();
  const spend = (redis: Layer.Layer<Redis>, maxAttempts = 5) =>
    Effect.runPromise(
      Effect.provide(
        spendAttemptBudget({
          key: "attempt-budget-test",
          windowSeconds: 60,
          maxAttempts,
          component: "c",
        }),
        Layer.mergeAll(redis, SentryLive),
      ),
    );

  test("AC-017 / AC-018 計数不能 (RedisError) は unavailable に倒し、Sentry に component 付きで 1 回記録する", async () => {
    const before = captured.length;
    expect(await spend(failingRedisLayer)).toBe("unavailable");
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
  });

  test("AC-019 count 0 は契約逸脱として unavailable に倒す (fail-closed の第 2 線)", async () => {
    expect(await spend(redisReturning({ count: 0, ttl: 60 }))).toBe("unavailable");
  });

  test("AC-020 count が上限ちょうどなら accepted", async () => {
    expect(await spend(redisReturning({ count: 5, ttl: 60 }), 5)).toBe("accepted");
  });

  test("AC-021 count が上限を 1 超えたら exhausted", async () => {
    expect(await spend(redisReturning({ count: 6, ttl: 60 }), 5)).toBe("exhausted");
  });
});
