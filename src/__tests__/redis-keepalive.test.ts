import { describe, expect, test } from "bun:test";
import { getRedis, redisStorage } from "../redis";
import { REDIS_KEEPALIVE_KEY, touchRedisKeepAliveProgram } from "../redis-keepalive";
import { runLive } from "./live-runner";

// Upstash free tier は PING を活動に数えず、SET/GET 等のデータ操作が 30 日無いと DB をアーカイブする
// (endpoint が消え magic link 送信が 500 になる。2026-09-03 に本番で発生)。keep-alive は「TTL 付き
// SET を 1 回打つ」以上のことをしない。
describe("Redis keep-alive", () => {
  test("TTL 付きの SET でキーを書き、値は実行時刻 (ISO 8601) になる", async () => {
    await redisStorage.delete(REDIS_KEEPALIVE_KEY);
    const before = Date.now();

    await runLive(touchRedisKeepAliveProgram);

    const redis = await getRedis();
    const value = await redis.get(REDIS_KEEPALIVE_KEY);
    expect(value).not.toBeNull();
    const writtenAt = Date.parse(value as string);
    expect(writtenAt).toBeGreaterThanOrEqual(before - 1000);
    expect(writtenAt).toBeLessThanOrEqual(Date.now() + 1000);
    // TTL 無しだと keep-alive の残骸が永続する。
    expect(await redis.ttl(REDIS_KEEPALIVE_KEY)).toBeGreaterThan(0);

    await redisStorage.delete(REDIS_KEEPALIVE_KEY);
  });
});
