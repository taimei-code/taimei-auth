import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";
import { mergeSessionIndex } from "../../src/session-index";
import { postgresTtlStore } from "../testing/ttl-store";
import { requireLocalDatabase } from "../testing/local-database";
import { prepareNonProductionTables } from "../testing/non-production-tables";

const P = "ttl-store-test-";
const database = requireLocalDatabase(process.env.DATABASE_URL);

const openStore = () => postgresTtlStore(database, mergeSessionIndex);

beforeAll(() => prepareNonProductionTables(database));

const expire = (key: string) =>
  db.execute(
    sql`UPDATE testing_ttl_store SET expires_at = now() - interval '1 second' WHERE key = ${key}`,
  );

const storedKeys = async () =>
  (
    await db.execute<{ key: string }>(
      sql`SELECT key FROM testing_ttl_store WHERE key LIKE ${`${P}%`} ORDER BY key`,
    )
  ).rows.map((row) => row.key);

afterEach(async () => {
  await db.execute(sql`DELETE FROM testing_ttl_store WHERE key LIKE ${`${P}%`}`);
});

describe("試験用の entry の TTL store は、container を作り直しても値を残すよう auth の DB に置く", () => {
  test("期限なしで置いた値は、作り直した store (再起動の代わり) でも読める", async () => {
    await (await openStore()).set(`${P}session`, "value");

    expect(await (await openStore()).get(`${P}session`)).toBe("value");
  });

  test("期限付きの値は、期限の内側では読め、期限を過ぎると読めない", async () => {
    const store = await openStore();
    await store.set(`${P}ttl`, "value", 60);
    expect(await store.get(`${P}ttl`)).toBe("value");

    await expire(`${P}ttl`);

    expect(await store.get(`${P}ttl`)).toBeNull();
  });

  test("同じ key に置き直すと、値と期限が置き換わる", async () => {
    const store = await openStore();
    await store.set(`${P}overwrite`, "first", 60);
    await expire(`${P}overwrite`);
    await store.set(`${P}overwrite`, "second");

    expect(await store.get(`${P}overwrite`)).toBe("second");
  });

  test("getAndDelete は 1 回目に値を返し、2 回目は null を返す", async () => {
    const store = await openStore();
    await store.set(`${P}once`, "value");

    expect(await store.getAndDelete(`${P}once`)).toBe("value");
    expect(await store.getAndDelete(`${P}once`)).toBeNull();
  });

  test("getAndDelete は期限の切れた値に null を返す", async () => {
    const store = await openStore();
    await store.set(`${P}expired-once`, "value", 60);
    await expire(`${P}expired-once`);

    expect(await store.getAndDelete(`${P}expired-once`)).toBeNull();
  });

  test("delete した key は読めない", async () => {
    const store = await openStore();
    await store.set(`${P}deleted`, "value");
    await store.delete(`${P}deleted`);

    expect(await store.get(`${P}deleted`)).toBeNull();
  });

  test("試行枠の計数は、期限の内側では 1 ずつ増え、期限を過ぎると 1 から数え直す", async () => {
    const store = await openStore();
    expect(await store.incrementRateWindow(`${P}window`, 60)).toEqual({ count: 1 });
    expect(await store.incrementRateWindow(`${P}window`, 60)).toEqual({ count: 2 });

    await expire(`${P}window`);

    expect(await store.incrementRateWindow(`${P}window`, 60)).toEqual({ count: 1 });
  });

  test("store を作ると、期限の切れた行を消し、期限の内側と期限なしの行は残す", async () => {
    const store = await openStore();
    await store.set(`${P}a-expired`, "value", 60);
    await store.set(`${P}b-live`, "value", 60);
    await store.set(`${P}c-forever`, "value");
    await expire(`${P}a-expired`);

    await openStore();

    expect(await storedKeys()).toEqual([`${P}b-live`, `${P}c-forever`]);
  });

  test("ping は DB に届けば成功する", async () => {
    expect(await (await openStore()).ping()).toBeUndefined();
  });

  test("利用者ごとの session の一覧への 2 つの書き込みを合わせると、両方の session を残す", async () => {
    const store = await openStore();
    const later = (seconds: number) => Date.now() + seconds * 1000;
    const listKey = `${P}active-sessions`;
    await store.set(listKey, JSON.stringify([{ token: "s0", expiresAt: later(60) }]), 60);

    await Promise.all([
      store.mergeSessionIndex(
        listKey,
        JSON.stringify([
          { token: "s0", expiresAt: later(60) },
          { token: "s1", expiresAt: later(120) },
        ]),
      ),
      store.mergeSessionIndex(
        listKey,
        JSON.stringify([
          { token: "s0", expiresAt: later(60) },
          { token: "s2", expiresAt: later(90) },
        ]),
      ),
    ]);

    const tokens = (JSON.parse((await store.get(listKey)) ?? "[]") as { token: string }[])
      .map(({ token }) => token)
      .sort();
    expect(tokens).toEqual(["s0", "s1", "s2"]);
  });
});
