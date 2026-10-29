import type { BetterAuthOptions } from "better-auth";
import type { Effect } from "effect";
import type { TtlStoreError } from "./errors";
import { betterAuthKey, isSessionIndexKey, type TtlKey } from "./ttl-key";
import { TtlStore } from "./ttl-store-service";

type TtlStoreRunner = {
  runPromise: <A, E>(effect: Effect.Effect<A, E, TtlStore>) => Promise<A>;
};

type TtlStoreShape = (typeof TtlStore)["Service"];

export const betterAuthStorage = (
  runtime: TtlStoreRunner,
): NonNullable<BetterAuthOptions["secondaryStorage"]> => {
  const run = <A>(effect: Effect.Effect<A, TtlStoreError, TtlStore>) => runtime.runPromise(effect);
  const unlessUnknownKey = <A>(
    key: string,
    absent: A,
    use: (store: TtlStoreShape, parsed: TtlKey) => Effect.Effect<A, TtlStoreError>,
  ): Promise<A> => {
    const parsed = betterAuthKey(key);
    return parsed === null
      ? Promise.resolve(absent)
      : run(TtlStore.use((store) => use(store, parsed)));
  };
  return {
    get: (key) => unlessUnknownKey(key, null, (store, parsed) => store.get(parsed)),
    getAndDelete: (key) =>
      unlessUnknownKey(key, null, (store, parsed) => store.getAndDelete(parsed)),
    delete: (key) => unlessUnknownKey(key, undefined, (store, parsed) => store.delete(parsed)),
    increment: () =>
      Promise.reject(
        new Error("TTL store: better-auth の rate limit は使わないので increment は書かない"),
      ),
    set: (key, value, ttl) => {
      const parsed = betterAuthKey(key);
      if (parsed === null) {
        return Promise.reject(
          new Error("TTL store: better-auth が知らない形の key に書こうとした"),
        );
      }
      return run(
        TtlStore.use((store) =>
          isSessionIndexKey(parsed)
            ? store.mergeSessionIndex(parsed, value)
            : store.set(parsed, value, ttl),
        ),
      );
    },
  };
};
