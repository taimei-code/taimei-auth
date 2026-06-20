import { createClient, type RedisClientType } from "redis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { isBunRuntime } from "./env";

// Workers (workerd) は TCP 常駐コネクションを張れないため、Bun/Node では node-redis、
// Workers では Upstash REST を init 時に選択する dual 構成。呼出側 (better-auth secondaryStorage /
// rate-limit) は redisStorage / incrementRateWindow の interface 越しに使い、実体を意識しない。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md

// better-auth secondaryStorage interface
export interface RedisStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// rate-limit window の状態: 現在の hit カウントと window 残り TTL (Retry-After 算出用)。
export type RateWindowResult = { count: number; ttl: number };

// ESM live binding: initRedis 後の値を import 側が参照する。
export let redisStorage: RedisStorage;
// key を windowSec の window で 1 hit 分 INCR し、現在カウントと TTL を返す rate-limit プリミティブ。
// INCR + EXPIRE + TTL を 1 往復 MULTI で atomic 化し、backend (node-redis / Upstash) は隠蔽する。
export let incrementRateWindow: (key: string, windowSec: number) => Promise<RateWindowResult>;
export let pingRedis: () => Promise<boolean>;
// node-redis の生クライアント (Bun / テストの key 操作用)。Workers では未代入 (= 参照しない)。
export let redis: RedisClientType;

// Workers: Upstash REST。automaticDeserialization:false で raw string 契約に合わせる
// (better-auth は JSON 文字列を保存するため auto-parse は二重処理になる。詳細: ADR-0011)。
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
}

// Bun / Node: node-redis (compose redis / テスト / CLI script)。
function initNodeRedis(redisUrl: string): void {
  const c = createClient({ url: redisUrl }) as RedisClientType;
  c.on("error", (err) => console.error("Redis error:", err));
  redis = c;
  redisStorage = {
    get: (key) => c.get(key),
    set: async (key, value, ttl) => {
      if (ttl) await c.set(key, value, { EX: ttl });
      else await c.set(key, value);
    },
    delete: async (key) => {
      await c.del(key);
    },
  };
  incrementRateWindow = async (key, windowSec) => {
    const res = await c.multi().incr(key).expire(key, windowSec).ttl(key).exec();
    return { count: Number(res?.[0] ?? 0), ttl: Number(res?.[2] ?? windowSec) };
  };
  pingRedis = () =>
    c
      .ping()
      .then(() => true)
      .catch(() => false);
}

// Upstash の REST 認証情報が揃っていれば Upstash、なければ node-redis を選択する。
// 値は process.env から読む (Workers entry は env→process.env 反映後に呼ぶ。worker.ts:initRuntime)。
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

export async function connectRedis(): Promise<void> {
  // Upstash REST はコネクションレス。node-redis (redis) のみ接続が要る。
  // Workers では redis 未代入のため no-op。
  if (redis && !redis.isOpen) await redis.connect();
}

// Bun / Node (compose / テスト / CLI): module ロード時に自動 init。
// Workers では Bun global が無いため skip し、worker entry が initRedis() を呼ぶ。
if (isBunRuntime()) {
  initRedis();
}
