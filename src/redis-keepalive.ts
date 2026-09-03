import type { RedisStorage } from "./redis";

// Upstash free tier は 30 日間データ操作 (SET/GET 等。PING は不算入) が無いと DB をアーカイブし REST endpoint
// を消す。session / verification が全て Redis にあるため、その瞬間から magic link 送信が 500 になる
// (2026-09-03 に本番で発生)。Workers の Cron Trigger (wrangler.jsonc triggers.crons) から毎日 TTL 付き SET を
// 1 回打って活動を作る。値は実行時刻にして Upstash Console から最終実行を確認できるようにする。
export const REDIS_KEEPALIVE_KEY = "keepalive:last-touched-at";

// cron 間隔 (1 日) より十分長く、かつ cron が止まっても残骸が永続しない長さ。
const KEEPALIVE_TTL_SEC = 7 * 24 * 60 * 60;

export async function touchRedisKeepAlive(storage: Pick<RedisStorage, "set">): Promise<void> {
  await storage.set(REDIS_KEEPALIVE_KEY, new Date().toISOString(), KEEPALIVE_TTL_SEC);
}
