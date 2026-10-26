import { Context, Effect, Layer, Schedule } from "effect";
import { TtlStoreError, timeoutAsBoundary, tryTtlStore } from "./errors";
import type { RateWindowResult, TtlStoreBackend } from "./ttl-store";
import type { TtlKey } from "./ttl-key";

export class TtlStore extends Context.Service<
  TtlStore,
  {
    get(key: TtlKey): Effect.Effect<string | null, TtlStoreError>;
    set(key: TtlKey, value: string, ttl?: number): Effect.Effect<void, TtlStoreError>;
    delete(key: TtlKey): Effect.Effect<void, TtlStoreError>;
    getAndDelete(key: TtlKey): Effect.Effect<string | null, TtlStoreError>;
    mergeSessionIndex(key: TtlKey, value: string): Effect.Effect<void, TtlStoreError>;
    incrementRateWindow(
      key: TtlKey,
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
      mergeSessionIndex: (key, value) => attemptOnce(() => backend.mergeSessionIndex(key, value)),
      incrementRateWindow: (key, windowSec) =>
        attemptOnce(() => backend.incrementRateWindow(key, windowSec)),
      ping: () => attemptOnce(backend.ping),
    }),
  );
