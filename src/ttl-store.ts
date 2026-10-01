import type { KvStore } from "./kv-store.do";
import type { MemoryKvStore } from "./kv-store.memory";

export interface TtlStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  // 無いと better-auth が get→delete に fallback し、並行 request が 1 回限りの verification を 2 回消費できる。
  getAndDelete(key: string): Promise<string | null>;
}

export type RateWindowResult = { count: number };

// 0 を返すと fail-open 側の試行枠で storage 障害が「通す」扱いになるため throw する。
export function toRateWindowResult(count: number): RateWindowResult {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`incrementRateWindow: 応答が契約に外れる (count=${count})`);
  }
  return { count };
}

export type TtlStoreBackend = TtlStorage & {
  incrementRateWindow(key: string, windowSec: number): Promise<RateWindowResult>;
  ping(): Promise<void>;
};

export type KvStoreNamespace = DurableObjectNamespace<KvStore>;

export function durableObjectBackend(ns: KvStoreNamespace): TtlStoreBackend {
  if (!ns)
    throw new Error(
      "durableObjectBackend: Workers では KV_STORE binding が必須 (in-memory へは落とさない)",
    );
  const stub = (key: string) => ns.getByName(key);
  return {
    get: (key) => stub(key).get(),
    set: (key, value, ttl) => stub(key).set(value, ttl),
    delete: (key) => stub(key).delete(),
    getAndDelete: (key) => stub(key).getAndDelete(),
    incrementRateWindow: async (key, windowSec) =>
      toRateWindowResult(await stub(key).incrementWindow(windowSec)),
    ping: async () => {
      await stub("health:ping").get();
    },
  };
}

export function memoryBackend(store: MemoryKvStore): TtlStoreBackend {
  return {
    get: async (key) => store.get(key),
    set: async (key, value, ttl) => store.set(key, value, ttl),
    delete: async (key) => store.delete(key),
    getAndDelete: async (key) => store.getAndDelete(key),
    incrementRateWindow: async (key, windowSec) =>
      toRateWindowResult(store.incrementWindow(key, windowSec)),
    ping: async () => {},
  };
}
