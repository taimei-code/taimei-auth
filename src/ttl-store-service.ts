import { Context, Effect, Layer, Schedule } from "effect";
import { TtlStoreError, timeoutAsBoundary, tryTtlStore } from "./errors";
import type { RateWindowResult, TtlStoreBackend } from "./ttl-store";

export class TtlStore extends Context.Service<
  TtlStore,
  {
    get(key: string): Effect.Effect<string | null, TtlStoreError>;
    set(key: string, value: string, ttl?: number): Effect.Effect<void, TtlStoreError>;
    delete(key: string): Effect.Effect<void, TtlStoreError>;
    getAndDelete(key: string): Effect.Effect<string | null, TtlStoreError>;
    incrementRateWindow(
      key: string,
      windowSec: number,
    ): Effect.Effect<RateWindowResult, TtlStoreError>;
    ping(): Effect.Effect<void, TtlStoreError>;
  }
>()("taimei/TtlStore") {}

const TTL_STORE_TIMEOUT = "2 seconds";
const retrySchedule = Schedule.exponential("100 millis").pipe(Schedule.jittered);
const withTtlStoreTimeout = timeoutAsBoundary(
  (cause) => new TtlStoreError({ cause }),
  TTL_STORE_TIMEOUT,
);

const withTtlStoreRetry = <A, R>(
  effect: Effect.Effect<A, TtlStoreError, R>,
): Effect.Effect<A, TtlStoreError, R> =>
  effect.pipe(Effect.retry({ schedule: retrySchedule, times: 3 }));

const attemptOnce = <A>(thunk: () => Promise<A>): Effect.Effect<A, TtlStoreError> =>
  withTtlStoreTimeout(tryTtlStore(thunk));
const readWithRetry = <A>(thunk: () => Promise<A>): Effect.Effect<A, TtlStoreError> =>
  withTtlStoreRetry(attemptOnce(thunk));

export const ttlStoreLayer = (backend: TtlStoreBackend) =>
  Layer.succeed(
    TtlStore,
    TtlStore.of({
      get: (key) => readWithRetry(() => backend.get(key)),
      set: (key, value, ttl) => attemptOnce(() => backend.set(key, value, ttl)),
      delete: (key) => attemptOnce(() => backend.delete(key)),
      getAndDelete: (key) => attemptOnce(() => backend.getAndDelete(key)),
      incrementRateWindow: (key, windowSec) =>
        attemptOnce(() => backend.incrementRateWindow(key, windowSec)),
      ping: () => attemptOnce(backend.ping),
    }),
  );
