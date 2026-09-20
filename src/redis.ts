import { createClient, type RedisClientType } from "redis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { isBunRuntime } from "./env";

// workerd は TCP 常駐コネクションを張れないため Bun/Node = node-redis / Workers = Upstash REST に分ける。

export interface RedisStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  // 未実装だと better-auth が get→delete に fallback し、並行 request が単回 verification を 2 回消費できる。
  getAndDelete(key: string): Promise<string | null>;
}

export type RateWindowResult = { count: number };

// count を 0 に潰すと fail-open 側の試行枠で storage 障害が「通す」に化けるため throw する (倒し方: CONTEXT.md「試行枠」)。
export function toRateWindowResult(res: unknown): RateWindowResult {
  const [rawCount] = Array.isArray(res) ? res : [];
  const count = typeof rawCount === "boolean" ? Number.NaN : Number(rawCount);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error(`incrementRateWindow: exec の応答が契約に外れる (count=${String(rawCount)})`);
  }
  return { count };
}

export let redisStorage: RedisStorage;
// INCR + EXPIRE を MULTI で atomic にするのは必須: INCR 後 EXPIRE 前に落ちると TTL 無し counter が永続残留する。
export let incrementRateWindow: (key: string, windowSec: number) => Promise<RateWindowResult>;
export let pingRedis: () => Promise<boolean>;
export let getRedis: () => Promise<RedisClientType>;

// automaticDeserialization:false は better-auth の JSON 文字列契約に合わせるため。
function initUpstash(url: string, token: string): void {
  const r = new UpstashRedis({ url, token, automaticDeserialization: false });
  redisStorage = {
    get: async (key) => (await r.get<string>(key)) ?? null,
    set: async (key, value, ttl) => {
      if (ttl) await r.set(key, value, { ex: ttl });
      else await r.set(key, value);
    },
    delete: async (key) => {
      await r.del(key);
    },
    getAndDelete: async (key) => (await r.getdel<string>(key)) ?? null,
  };
  incrementRateWindow = async (key, windowSec) =>
    toRateWindowResult(await r.multi().incr(key).expire(key, windowSec).exec());
  pingRedis = () =>
    r
      .ping()
      .then(() => true)
      .catch(() => false);
  getRedis = async () => {
    throw new Error(
      "getRedis は node-redis 専用 accessor。Workers (Upstash REST) では利用できない",
    );
  };
}

function initNodeRedis(redisUrl: string): void {
  const c = createClient({ url: redisUrl }) as RedisClientType;
  c.on("error", (err) => console.error("Redis error:", err));

  // open 済み client への再 connect() は node-redis が reject するため memo は in-flight の connect だけ持つ。
  let connecting: Promise<unknown> | undefined;
  const connectedClient = async (): Promise<RedisClientType> => {
    // isOpen は connect() 開始で同期的に true になるため、それだけ見ると 2 人目が未 ready の client を掴む。
    if (!c.isOpen) {
      connecting ??= c.connect().finally(() => {
        connecting = undefined;
      });
    }
    if (connecting !== undefined) await connecting;
    return c;
  };

  getRedis = connectedClient;
  redisStorage = {
    get: async (key) => (await connectedClient()).get(key),
    set: async (key, value, ttl) => {
      const redis = await connectedClient();
      if (ttl) await redis.set(key, value, { EX: ttl });
      else await redis.set(key, value);
    },
    delete: async (key) => {
      await (await connectedClient()).del(key);
    },
    getAndDelete: async (key) => (await connectedClient()).getDel(key),
  };
  incrementRateWindow = async (key, windowSec) => {
    const redis = await connectedClient();
    return toRateWindowResult(await redis.multi().incr(key).expire(key, windowSec).exec());
  };
  // reject しない boolean 契約 (/health が 503 degraded に倒す)。未決着の間は resolve せず打ち切りは呼び出し側。
  pingRedis = () =>
    connectedClient()
      .then((redis) => redis.ping())
      .then(() => true)
      .catch(() => false);
}

export type KvStoreNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): import("./kv-store.do").KvStore;
};

function initDurableObject(ns: KvStoreNamespace): void {
  const stub = (key: string) => ns.get(ns.idFromName(key));
  redisStorage = {
    get: (key) => stub(key).get(),
    set: (key, value, ttl) => stub(key).set(value, ttl),
    delete: (key) => stub(key).delete(),
    getAndDelete: (key) => stub(key).getAndDelete(),
  };
  incrementRateWindow = async (key, windowSec) =>
    toRateWindowResult([await stub(key).incrementWindow(windowSec)]);
  pingRedis = () =>
    stub("health:ping")
      .get()
      .then(() => true)
      .catch(() => false);
  getRedis = async () => {
    throw new Error("getRedis は node-redis 専用 accessor。Workers (Durable Objects) では利用できない");
  };
}

// PoC (候補 A): bun test を Redis なしで走らせるための in-memory 実装。KvStore と同じ 1 key = 1 entry モデル。
function initMemory(): void {
  const entries = new Map<string, { value: string; expiresAt: number | null }>();
  const live = (key: string) => {
    const e = entries.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      entries.delete(key);
      return null;
    }
    return e;
  };
  redisStorage = {
    get: async (key) => live(key)?.value ?? null,
    set: async (key, value, ttl) => {
      entries.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
    },
    delete: async (key) => {
      entries.delete(key);
    },
    getAndDelete: async (key) => {
      const e = live(key);
      entries.delete(key);
      return e?.value ?? null;
    },
  };
  incrementRateWindow = async (key, windowSec) => {
    const count = Number(live(key)?.value ?? 0) + 1;
    entries.set(key, { value: String(count), expiresAt: Date.now() + windowSec * 1000 });
    return { count };
  };
  pingRedis = async () => true;
  getRedis = async () => {
    throw new Error("getRedis は node-redis 専用 accessor。memory backend では利用できない");
  };
}

export function initRedis(kvStore?: KvStoreNamespace): void {
  if (redisStorage) return;
  if (kvStore) {
    initDurableObject(kvStore);
    return;
  }
  if (process.env.REDIS_URL === "memory") {
    initMemory();
    return;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    initUpstash(url, token);
    return;
  }
  initNodeRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
}

if (isBunRuntime()) {
  initRedis();
}
