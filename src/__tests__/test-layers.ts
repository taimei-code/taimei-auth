import { Effect, Layer } from "effect";
import { TtlStoreError } from "../errors";
import { HealthRepo } from "../health/ports";
import type { RateWindowResult } from "../ttl-store";
import { TtlStore } from "../ttl-store-service";
import { partial } from "./live-runner";

export const failingTtlStoreLayer: Layer.Layer<TtlStore> = Layer.succeed(
  TtlStore,
  partial<TtlStore["Service"]>({
    incrementRateWindow: () =>
      Effect.fail(new TtlStoreError({ cause: new Error("test: ttl store down") })),
  }),
);

export const ttlStoreReturning = (result: RateWindowResult): Layer.Layer<TtlStore> =>
  Layer.succeed(
    TtlStore,
    partial<TtlStore["Service"]>({ incrementRateWindow: () => Effect.succeed(result) }),
  );

export const healthRepoLayer = (
  pingDatabase: HealthRepo["Service"]["pingDatabase"],
): Layer.Layer<HealthRepo> => Layer.succeed(HealthRepo, { pingDatabase });

export const ttlStorePingLayer = (ping: TtlStore["Service"]["ping"]): Layer.Layer<TtlStore> =>
  Layer.succeed(TtlStore, partial<TtlStore["Service"]>({ ping }));
