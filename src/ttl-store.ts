import type { KvStore } from "./kv-store.do";
import type { MemoryKvStore } from "./kv-store.memory";
import { HEALTH_PING_KEY, type TtlKey } from "./ttl-key";

export interface TtlStorage {
  get(key: TtlKey): Promise<string | null>;
  set(key: TtlKey, value: string, ttl?: number): Promise<void>;
  delete(key: TtlKey): Promise<void>;
  getAndDelete(key: TtlKey): Promise<string | null>;
}

export type RateWindowResult = { count: number };

export function toRateWindowResult(count: number): RateWindowResult {
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`incrementRateWindow: 応答が契約に外れる (count=${count})`);
  }
  return { count };
}

export type TtlStoreBackend = TtlStorage & {
  mergeSessionIndex(key: TtlKey, value: string): Promise<void>;
  incrementRateWindow(key: TtlKey, windowSec: number): Promise<RateWindowResult>;
  ping(): Promise<void>;
};

export type KvStoreNamespace = DurableObjectNamespace<KvStore>;

export function durableObjectBackend(ns: KvStoreNamespace): TtlStoreBackend {
  if (!ns)
    throw new Error(
      "durableObjectBackend: Workers では KV_STORE binding が必須 (in-memory へは落とさない)",
    );
  const stub = (key: TtlKey) => ns.getByName(key);
  return {
    get: (key) => stub(key).get(),
    set: (key, value, ttl) => stub(key).set(value, ttl),
    delete: (key) => stub(key).delete(),
    getAndDelete: (key) => stub(key).getAndDelete(),
    mergeSessionIndex: (key, value) => stub(key).mergeSessionIndex(value),
    incrementRateWindow: async (key, windowSec) =>
      toRateWindowResult(await stub(key).incrementWindow(windowSec)),
    ping: async () => {
      await stub(HEALTH_PING_KEY).get();
    },
  };
}

export function memoryBackend(store: MemoryKvStore): TtlStoreBackend {
  return {
    get: async (key) => store.get(key),
    set: async (key, value, ttl) => store.set(key, value, ttl),
    delete: async (key) => store.delete(key),
    getAndDelete: async (key) => store.getAndDelete(key),
    mergeSessionIndex: async (key, value) => store.mergeSessionIndex(key, value),
    incrementRateWindow: async (key, windowSec) =>
      toRateWindowResult(store.incrementWindow(key, windowSec)),
    ping: async () => {},
  };
}
