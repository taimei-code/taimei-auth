import { describe, expect, test } from "bun:test";
import { getRedis, pingRedis, redisStorage } from "../redis";

// 過去の退行: 接続が connectRedis() の opt-in で、呼び忘れたファイルだけのサブセット実行が
// ClientClosedError になっていた (フル実行は先行ファイルの接続に偶然依存)。
// このファイルの単独実行 (bun test src/__tests__/redis-lifecycle.test.ts) が cold 順序の再現になる。
// 担保するのは初回接続の順序のみ — mid-life 切断の再接続は node-redis reconnectStrategy の責務。
describe("redis adapter の接続 lifecycle", () => {
  test("cold: 未接続のまま adapter を呼んでも接続込みで成功する", async () => {
    await redisStorage.set("redis-lifecycle-test:cold", "1", 60);
    expect(await redisStorage.get("redis-lifecycle-test:cold")).toBe("1");
    await redisStorage.delete("redis-lifecycle-test:cold");
  });

  // boot (src/index.ts) は pingRedis で接続を温めてから adapter が呼ばれる。open 済み client への
  // 再 connect() は node-redis が reject するため、warm 経路が例外にならないことを固定する。
  test("warm: pingRedis で接続済みにした後の adapter 呼び出しが二重 connect にならない", async () => {
    expect(await pingRedis()).toBe(true);
    await redisStorage.set("redis-lifecycle-test:warm", "1", 60);
    expect(await redisStorage.get("redis-lifecycle-test:warm")).toBe("1");
    await redisStorage.delete("redis-lifecycle-test:warm");
  });

  // isOpen は connect() 開始で同期的に true になるため接続完了の証明にならない。isReady で固定する
  test("getRedis は接続完了済みの生 client を返す", async () => {
    const redis = await getRedis();
    expect(redis.isReady).toBe(true);
  });
});
