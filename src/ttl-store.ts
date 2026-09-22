import { isBunRuntime } from "./env";
import type { KvStore } from "./kv-store.do";
import { MemoryKvStore } from "./kv-store.memory";

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

export let ttlStorage: TtlStorage;
export let incrementRateWindow: (key: string, windowSec: number) => Promise<RateWindowResult>;
export let pingTtlStore: () => Promise<void>;
export let getMemoryKvStore: () => MemoryKvStore;

export type KvStoreNamespace = DurableObjectNamespace<KvStore>;

function initDurableObject(ns: KvStoreNamespace): void {
  const stub = (key: string) => ns.getByName(key);
  ttlStorage = {
    get: (key) => stub(key).get(),
    set: (key, value, ttl) => stub(key).set(value, ttl),
    delete: (key) => stub(key).delete(),
    getAndDelete: (key) => stub(key).getAndDelete(),
  };
  incrementRateWindow = async (key, windowSec) =>
    toRateWindowResult(await stub(key).incrementWindow(windowSec));
  pingTtlStore = async () => {
    await stub("health:ping").get();
  };
  getMemoryKvStore = () => {
    throw new Error(
      "getMemoryKvStore は Bun (in-memory) 専用の test accessor。Workers では利用できない",
    );
  };
}

function initMemory(): void {
  const store = new MemoryKvStore();
  ttlStorage = {
    get: async (key) => store.get(key),
    set: async (key, value, ttl) => store.set(key, value, ttl),
    delete: async (key) => store.delete(key),
    getAndDelete: async (key) => store.getAndDelete(key),
  };
  incrementRateWindow = async (key, windowSec) =>
    toRateWindowResult(store.incrementWindow(key, windowSec));
  pingTtlStore = async () => {};
  getMemoryKvStore = () => store;
}

export function initTtlStore(kvStore?: KvStoreNamespace): void {
  if (ttlStorage) return;
  if (kvStore) initDurableObject(kvStore);
  else if (isBunRuntime()) initMemory();
  else
    throw new Error(
      "initTtlStore: Workers では KV_STORE binding が必須 (in-memory へは落とさない)",
    );
}

if (isBunRuntime()) {
  initTtlStore();
}
