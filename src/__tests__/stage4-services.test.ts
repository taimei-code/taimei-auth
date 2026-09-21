import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { Background, BackgroundLive, withWaitUntil } from "../background";
import { TtlStoreError, timeoutAsBoundary, tryTtlStore } from "../errors";
import { HealthRepo } from "../health/ports";
import { HealthRepoLive } from "../health/wiring";
import { getMemoryKvStore, pingTtlStore } from "../ttl-store";
import { TtlStore, TtlStoreLive } from "../ttl-store-service";

// ADR-0017 Stage 4 の runtime primitive / boundary service。in-memory store + compose Postgres を使う。
describe("TtlStore service (live)", () => {
  const run = <A, E>(p: Effect.Effect<A, E, TtlStore>) =>
    Effect.runPromise(Effect.provide(p, TtlStoreLive));
  const key = `stage4-test:${Date.now()}`;

  test("set → get → delete が Effect で往復する", async () => {
    const value = await run(
      TtlStore.use((ttlStore) =>
        Effect.gen(function* () {
          yield* ttlStore.set(key, "v", 30);
          const got = yield* ttlStore.get(key);
          yield* ttlStore.delete(key);
          return got;
        }),
      ),
    );
    expect(value).toBe("v");
  });

  test("ping は成功で resolve する (in-memory は常に到達可能)", async () => {
    expect(await run(TtlStore.use((ttlStore) => ttlStore.ping()))).toBeUndefined();
    expect(await pingTtlStore()).toBeUndefined();
  });

  test("incrementRateWindow は count を返し EXPIRE を付ける (再試行しない書き込み系)", async () => {
    const r = await run(TtlStore.use((ttlStore) => ttlStore.incrementRateWindow(`${key}:w`, 5)));
    expect(r.count).toBe(1);
    const rawTtl = getMemoryKvStore().ttl(`${key}:w`);
    expect(rawTtl).toBeGreaterThanOrEqual(1);
    expect(rawTtl).toBeLessThanOrEqual(5);
    await run(TtlStore.use((ttlStore) => ttlStore.delete(`${key}:w`)));
  });
});

describe("timeoutAsBoundary", () => {
  test("期限内に終わらない境界呼び出しは boundary error (cause = TimeoutError) になる", async () => {
    const wrap = timeoutAsBoundary((cause) => new TtlStoreError({ cause }), "10 millis");
    const e = await Effect.runPromise(
      Effect.flip(wrap(tryTtlStore(() => new Promise<never>(() => {})))),
    );
    expect(e).toBeInstanceOf(TtlStoreError);
    expect(Cause.isTimeoutError(e.cause)).toBe(true);
  });
});

describe("Background service", () => {
  test("run は fiber を detach し、完了 Promise を ALS carrier に登録する", async () => {
    const collected: Promise<unknown>[] = [];
    let ran = false;
    await withWaitUntil(
      (p) => {
        collected.push(p);
      },
      () =>
        Effect.runPromise(
          Effect.provide(
            Background.use((bg) =>
              bg.run(
                Effect.sync(() => {
                  ran = true;
                }),
              ),
            ),
            BackgroundLive,
          ),
        ),
    );
    expect(collected.length).toBe(1);
    await collected[0];
    expect(ran).toBe(true);
  });
});
describe("HealthRepo (live)", () => {
  test("pingDatabase が成功で resolve する", async () => {
    const result = await Effect.runPromise(
      Effect.provide(
        HealthRepo.use((repo) => repo.pingDatabase()),
        HealthRepoLive,
      ),
    );
    expect(result).toBeUndefined();
  });
});
