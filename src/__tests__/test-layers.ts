import { Effect, Layer } from "effect";
import { RedisError } from "../errors";
import type { RateWindowResult } from "../redis";
import { Redis } from "../redis-service";
import { partial } from "./live-runner";

// repository 全体で使う service stub (src/CLAUDE.md「test配置」)。domain 固有の stub は各 domain の
// __tests__/test-layers.ts に置く。program 側で `Effect.provide(layer)` して使う。

// 計数不能を注入する Redis。試行枠の倒し方 (fail-closed / fail-open) を呼び手ごとに観測するための seam。
export const failingRedisLayer: Layer.Layer<Redis> = Layer.succeed(
  Redis,
  partial<Redis["Service"]>({
    incrementRateWindow: () =>
      Effect.fail(new RedisError({ cause: new Error("test: redis down") })),
  }),
);

// 固定の count / ttl を返す Redis。上限の境界と第 2 線 (count 0) を Redis 無しで観測する。
export const redisReturning = (result: RateWindowResult): Layer.Layer<Redis> =>
  Layer.succeed(
    Redis,
    partial<Redis["Service"]>({ incrementRateWindow: () => Effect.succeed(result) }),
  );
