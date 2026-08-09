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
  // better-auth の single-use verification value の消費口。未実装だと get→delete の 2 往復に
  // fallback し、isolate を跨ぐ (workerd) 並行 request が同じ値を 2 回消費できてしまう。
  getAndDelete(key: string): Promise<string | null>;
}

// rate-limit window の状態: 現在の hit カウントと window 残り TTL (Retry-After 算出用)。
export type RateWindowResult = { count: number; ttl: number };

// ESM live binding: initRedis 後の値を import 側が参照する。
export let redisStorage: RedisStorage;
// key を windowSec の window で 1 hit 分 INCR し、現在カウントと TTL を返す rate-limit プリミティブ。
// INCR + EXPIRE + TTL を 1 往復 MULTI で atomic 化し、backend (node-redis / Upstash) は隠蔽する。
// atomic 化は必須 — INCR 後 EXPIRE 設定までに crash すると TTL なし counter が永続残留する。
export let incrementRateWindow: (key: string, windowSec: number) => Promise<RateWindowResult>;
export let pingRedis: () => Promise<boolean>;
// テストの key 直接操作専用の生 client accessor。接続保証込みで返すため、呼び出し順の儀式は不要。
// production は redisStorage / incrementRateWindow の interface 越しに使うこと (biome の
// noRestrictedImports がテスト以外からの import を拒否する)。
export let getRedis: () => Promise<RedisClientType>;

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

  // 接続の入口はここ 1 つ (単一所有)。open 済み client への再 connect() は node-redis が必ず
  // reject するため、boot・adapter・テストが各自 connect を持つと相互に壊し合う。memo は
  // in-flight の connect だけを保持し決着で破棄する — 成功や失敗を持ち越すと「client が閉じた
  // 後も即 resolve」「一過性の接続失敗の引きずり」がプロセス寿命続く。切断からの復旧は
  // node-redis 内蔵 reconnectStrategy の責務で、ここでは担わない。
  // adapter も getRedis もこの取得口を通る — メソッド追加時に接続保証を書き忘れる余地を残さない。
  let connecting: Promise<unknown> | undefined;
  const connectedClient = async (): Promise<RedisClientType> => {
    // isOpen は connect() 開始で同期的に true になるため、それだけを見ると並行呼び出しの
    // 2 人目が未 ready の client を受け取る。in-flight の connect は全員が await する。
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
  // 決して reject しない boolean 契約。/health はこれを try/catch なしで待ち、redis 断を
  // 503 degraded として返す設計のため、接続保証の失敗も false に畳む (reject が漏れると 500 に化ける)。
  // 注意: redis 断で接続が確立も失敗もしない間は resolve しない (既定 reconnectStrategy が
  // 無限リトライ)。打ち切りは呼び出し側が担う (src/index.ts の boot race が実例)。
  pingRedis = () =>
    connectedClient()
      .then((redis) => redis.ping())
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

// Bun / Node (compose / テスト / CLI): module ロード時に自動 init。
// Workers では Bun global が無いため skip し、worker entry が initRedis() を呼ぶ。
if (isBunRuntime()) {
  initRedis();
}
