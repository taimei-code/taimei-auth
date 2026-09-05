import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { Background, BackgroundLive, withWaitUntil } from "../background";
import { RedisError, timeoutAsBoundary, tryRedis } from "../errors";
import { HealthRepo } from "../health/ports";
import { HealthRepoLive } from "../health/wiring";
import { Redis, RedisLive } from "../redis-service";

// ADR-0017 Stage 4 の runtime primitive / boundary service。compose Redis + Postgres を使う。
describe("Redis service (live)", () => {
  const run = <A, E>(p: Effect.Effect<A, E, Redis>) =>
    Effect.runPromise(Effect.provide(p, RedisLive));
  const key = `stage4-test:${Date.now()}`;

  test("set → get → delete が Effect で往復する", async () => {
    const value = await run(
      Redis.use((redis) =>
        Effect.gen(function* () {
          yield* redis.set(key, "v", 30);
          const got = yield* redis.get(key);
          yield* redis.delete(key);
          return got;
        }),
      ),
    );
    expect(value).toBe("v");
  });

  test("ping は boolean を返す", async () => {
    expect(await run(Redis.use((redis) => redis.ping()))).toBe(true);
  });

  test("incrementRateWindow は count と ttl を返す (再試行しない書き込み系)", async () => {
    const r = await run(Redis.use((redis) => redis.incrementRateWindow(`${key}:w`, 5)));
    expect(r.count).toBe(1);
    expect(r.ttl).toBeGreaterThan(0);
    await run(Redis.use((redis) => redis.delete(`${key}:w`)));
  });
});

describe("timeoutAsBoundary", () => {
  test("期限内に終わらない境界呼び出しは boundary error (cause = TimeoutError) になる", async () => {
    const wrap = timeoutAsBoundary((cause) => new RedisError({ cause }), "10 millis");
    const e = await Effect.runPromise(
      Effect.flip(wrap(tryRedis(() => new Promise<never>(() => {})))),
    );
    expect(e).toBeInstanceOf(RedisError);
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
  test("pingDatabase が true", async () => {
    const ok = await Effect.runPromise(
      Effect.provide(
        HealthRepo.use((repo) => repo.pingDatabase()),
        HealthRepoLive,
      ),
    );
    expect(ok).toBe(true);
  });
});
