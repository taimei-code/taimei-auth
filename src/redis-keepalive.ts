import { Clock, Effect } from "effect";
import { Redis, withRedisRetry } from "./redis-service";

// Upstash free tier は 30 日間データ操作 (SET/GET 等。PING は不算入) が無いと DB をアーカイブし REST endpoint
// を消す。session / verification が全て Redis にあるため、その瞬間から magic link 送信が 500 になる
// (2026-09-03 に本番で発生)。Workers の Cron Trigger (wrangler.jsonc triggers.crons) から毎日 TTL 付き SET を
// 1 回打って活動を作る。値は実行時刻にして Upstash Console から最終実行を確認できるようにする。
export const REDIS_KEEPALIVE_KEY = "keepalive:last-touched-at";

// cron 間隔 (1 日) より十分長く、かつ cron が止まっても残骸が永続しない長さ。
const KEEPALIVE_TTL_SEC = 7 * 24 * 60 * 60;

// Cron Trigger の entry (src/worker.ts の scheduled) が runtime で走らせる。SET は同じ key への上書きで冪等なので
// retry する (ADR-0017 Decision の非同期項が retry 対象とする「Redis 読み取り系、keepalive」)。機会は 1 日 1 回で、
// 30 日連続で落ちるとアーカイブが起きるため、一時的な遅延で取りこぼさない。retry を尽くした失敗 (RedisError) は
// entry が throw して Sentry に載せる。
export const touchRedisKeepAliveProgram = Effect.gen(function* () {
  const redis = yield* Redis;
  const now = yield* Clock.currentTimeMillis;
  yield* redis.set(REDIS_KEEPALIVE_KEY, new Date(now).toISOString(), KEEPALIVE_TTL_SEC);
}).pipe(withRedisRetry);
