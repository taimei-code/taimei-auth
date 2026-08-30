import { createClient, type RedisClientType } from "redis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { isBunRuntime } from "./env";

// Workers (workerd) は TCP 常駐コネクションを張れないため、Bun/Node = node-redis / Workers = Upstash
// REST を init 時に選択する dual 構成。呼出側は interface 越しに使う (詳細: ADR-0011)。

// better-auth secondaryStorage interface
export interface RedisStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  // single-use verification 値の消費口。未実装だと get→delete に fallback し並行 request が 2 回消費できる。
  getAndDelete(key: string): Promise<string | null>;
}

// rate-limit window の状態: 現在の hit カウントと window 残り TTL (Retry-After 算出用)。
export type RateWindowResult = { count: number; ttl: number };

// ESM live binding: initRedis 後の値を import 側が参照する。
export let redisStorage: RedisStorage;
// key を windowSec の window で 1 hit INCR し、現在カウントと TTL を返す。INCR + EXPIRE + TTL の MULTI
// による atomic 化は必須 — INCR 後 EXPIRE 前に crash すると TTL なし counter が永続残留する。
export let incrementRateWindow: (key: string, windowSec: number) => Promise<RateWindowResult>;
export let pingRedis: () => Promise<boolean>;
// テストの key 直接操作専用の生 client accessor (接続保証込み)。production は interface 越しに使う
// (biome の noRestrictedImports がテスト以外からの import を拒否する)。
export let getRedis: () => Promise<RedisClientType>;

// Workers: Upstash REST。automaticDeserialization:false は better-auth の JSON 文字列契約に合わせる (ADR-0011)。
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
  incrementRateWindow = async (key, windowSec) => {
    const res = (await r.multi().incr(key).expire(key, windowSec).ttl(key).exec()) as [
      number,
      unknown,
      number,
    ];
    return { count: Number(res[0] ?? 0), ttl: Number(res[2] ?? windowSec) };
  };
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

// Bun / Node: node-redis (compose redis / テスト / CLI script)。
function initNodeRedis(redisUrl: string): void {
  const c = createClient({ url: redisUrl }) as RedisClientType;
  c.on("error", (err) => console.error("Redis error:", err));

  // 接続の入口はここ 1 つ (単一所有)。open 済み client への再 connect() は node-redis が reject するため、
  // memo は in-flight の connect だけを保持し決着で破棄する (持ち越すと閉じた後も即 resolve が続く)。
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
    const res = await redis.multi().incr(key).expire(key, windowSec).ttl(key).exec();
    return { count: Number(res?.[0] ?? 0), ttl: Number(res?.[2] ?? windowSec) };
  };
  // 決して reject しない boolean 契約 (/health が try/catch なしで待ち redis 断を 503 degraded にするため)。
  // 注意: 接続が確立も失敗もしない間は resolve しない — 打ち切りは呼び出し側 (src/index.ts の boot race)。
  pingRedis = () =>
    connectedClient()
      .then((redis) => redis.ping())
      .then(() => true)
      .catch(() => false);
}

// Upstash の REST 認証情報が揃えば Upstash、なければ node-redis (Workers は env→process.env 反映後に呼ぶ)。
export function initRedis(): void {
  if (redisStorage) return;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    initUpstash(url, token);
    return;
  }
  initNodeRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
}

// Bun / Node は module ロード時に自動 init (Workers は worker entry が initRedis を呼ぶ)。
if (isBunRuntime()) {
  initRedis();
}
