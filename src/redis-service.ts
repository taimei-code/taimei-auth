import { Context, Effect, Layer, Schedule } from "effect";
import { RedisError, timeoutAsBoundary, tryRedis } from "./errors";
import { incrementRateWindow, pingRedis, type RateWindowResult, redisStorage } from "./redis";

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

const withRedisRetry = <A, R>(
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
    ping: () => attemptOnce(() => pingRedis()),
  }),
);
