import { Effect, Layer } from "effect";
import { TtlStoreError } from "../errors";
import type { RateWindowResult } from "../ttl-store";
import { TtlStore } from "../ttl-store-service";
import { partial } from "./live-runner";

// repository 全体で使う service stub (src/CLAUDE.md「test配置」)。domain 固有の stub は各 domain の
// __tests__/test-layers.ts に置く。program 側で `Effect.provide(layer)` して使う。

// 計数不能を注入する TTL store。試行枠の倒し方 (fail-closed / fail-open) を呼び手ごとに観測するための seam。
export const failingTtlStoreLayer: Layer.Layer<TtlStore> = Layer.succeed(
  TtlStore,
  partial<TtlStore["Service"]>({
    incrementRateWindow: () =>
      Effect.fail(new TtlStoreError({ cause: new Error("test: ttl store down") })),
  }),
);

// 固定の count を返す TTL store。上限の境界と第 2 線 (count 0) を TTL store 無しで観測する。
export const ttlStoreReturning = (result: RateWindowResult): Layer.Layer<TtlStore> =>
  Layer.succeed(
    TtlStore,
    partial<TtlStore["Service"]>({ incrementRateWindow: () => Effect.succeed(result) }),
  );
