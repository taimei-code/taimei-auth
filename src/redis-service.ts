import { Context, Effect, Layer, Schedule } from "effect";
import { RedisError, timeoutAsBoundary, tryRedis } from "./errors";
import { incrementRateWindow, pingRedis, type RateWindowResult, redisStorage } from "./redis";
// Effect service 版 (ADR-0017 Stage 4、Decision の非同期項)。自前の呼び出し (rate-limit / attempt-budget / keepalive /
// health) はこの service を経由する。better-auth の secondaryStorage だけは Promise interface (redisStorage) を
// 直接受ける (境界)。live は initRedis() 後の let 束縛を呼び出し時に読む。
// retry を許すのは冪等な呼び出しだけ (ADR-0017 Decision の非同期項): 読み取り (get) と keepalive の SET (src/redis-keepalive.ts が
// withRedisRetry を使う)。policy は exponential 100ms 起点 + jitter で再試行 3 回 (計 4 attempt)、backoff の合計は
// 1s 未満。timeout 2s は attempt ごとに掛かる (Redis 無応答時の総待ちは ADR-0017 Consequences)。
// 再送が二重計上 / 二重消費になる呼び出し (INCR 系・getAndDelete) と、失敗を degraded に畳むだけで応答時間を
// 伸ばしたくない ping (/health) は attemptOnce。
export class Redis extends Context.Service<
  Redis,
  {
    get(key: string): Effect.Effect<string | null, RedisError>;
    set(key: string, value: string, ttl?: number): Effect.Effect<void, RedisError>;
    delete(key: string): Effect.Effect<void, RedisError>;
    getAndDelete(key: string): Effect.Effect<string | null, RedisError>;
    incrementRateWindow(
      key: string,
      windowSec: number,
    ): Effect.Effect<RateWindowResult, RedisError>;
    ping(): Effect.Effect<boolean, RedisError>;
  }
>()("taimei/Redis") {}

const REDIS_TIMEOUT = "2 seconds";
const retrySchedule = Schedule.exponential("100 millis").pipe(Schedule.jittered);
const withRedisTimeout = timeoutAsBoundary((cause) => new RedisError({ cause }), REDIS_TIMEOUT);

// 冪等な Redis 呼び出しにだけ掛ける retry policy。Layer の get と keepalive が共有する。
export const withRedisRetry = <A, R>(
  effect: Effect.Effect<A, RedisError, R>,
): Effect.Effect<A, RedisError, R> =>
  effect.pipe(Effect.retry({ schedule: retrySchedule, times: 3 }));

const attemptOnce = <A>(thunk: () => Promise<A>): Effect.Effect<A, RedisError> =>
  withRedisTimeout(tryRedis(thunk));
const readWithRetry = <A>(thunk: () => Promise<A>): Effect.Effect<A, RedisError> =>
  withRedisRetry(attemptOnce(thunk));

export const RedisLive = Layer.succeed(
  Redis,
  Redis.of({
    get: (key) => readWithRetry(() => redisStorage.get(key)),
    set: (key, value, ttl) => attemptOnce(() => redisStorage.set(key, value, ttl)),
    delete: (key) => attemptOnce(() => redisStorage.delete(key)),
    getAndDelete: (key) => attemptOnce(() => redisStorage.getAndDelete(key)),
    incrementRateWindow: (key, windowSec) => attemptOnce(() => incrementRateWindow(key, windowSec)),
    // pingRedis は reject しない boolean 契約。false (到達不能) は failure でなく値として返す。
    ping: () => attemptOnce(() => pingRedis()),
  }),
);
