import { afterEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";
import { requireLocalDatabase } from "../testing/local-database";
import { requireMarkedDatabase } from "../testing/non-production-database";
import {
  prepareMarkedNonProductionTables,
  prepareNonProductionTables,
} from "../testing/non-production-tables";

const createMark = () => db.execute(sql`CREATE TABLE IF NOT EXISTS non_production_database ()`);
const dropMark = () => db.execute(sql`DROP TABLE IF EXISTS non_production_database`);

const browserAccountTable = async () =>
  (
    await db.execute<{ table: string | null }>(
      sql`SELECT to_regclass('public.testing_browser_account')::text AS table`,
    )
  ).rows[0]?.table ?? null;

afterEach(dropMark);

describe("staging の入口と表の準備は、本番以外の DB の印の表がある DB でだけ進む", () => {
  test("印の表が無い DB では、表の名前を message に含めて失敗する", async () => {
    await dropMark();

    await expect(requireMarkedDatabase()).rejects.toThrow("non_production_database");
  });

  test("印の表がある DB では、確かめた印を返す", async () => {
    await createMark();

    expect(await requireMarkedDatabase()).toEqual({ _tag: "Marked" });
  });

  test("印の表が無い DB では、表の準備は失敗し、本番以外の表に触れない", async () => {
    await dropMark();
    const before = await browserAccountTable();

    await expect(prepareMarkedNonProductionTables()).rejects.toThrow("non_production_database");
    expect(await browserAccountTable()).toBe(before);
  });
});

describe("フィーチャーフラグの切り替えを残す表が残っている DB でも、本番以外の表の準備は進み、表の行を消さない", () => {
  const LEFT_FLAG = "non-production-tables-left-flag";
  const leftRows = async () =>
    (
      await db.execute<{ flag: string }>(
        sql`SELECT flag FROM testing_feature_flag_rules WHERE flag = ${LEFT_FLAG}`,
      )
    ).rows;

  afterEach(async () => {
    await db.execute(sql`DELETE FROM testing_feature_flag_rules WHERE flag = ${LEFT_FLAG}`);
  });

  test("表と行が残っていても、表の準備は成功し、その行は残る", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS testing_feature_flag_rules (
        flag text PRIMARY KEY,
        enabled boolean NOT NULL,
        everyone boolean NOT NULL,
        company_ids text[] NOT NULL
      )`);
    await db.execute(sql`
      INSERT INTO testing_feature_flag_rules (flag, enabled, everyone, company_ids)
      VALUES (${LEFT_FLAG}, false, true, '{}')`);

    await prepareNonProductionTables(requireLocalDatabase(process.env.DATABASE_URL));

    expect(await leftRows()).toEqual([{ flag: LEFT_FLAG }]);
  });
});

describe("本番以外の表の準備は、host の照合か印の確認を通った値を受け取ってからにする", () => {
  test("local と確かめていない DB の値は、型で渡せない", () => {
    const remote = { _tag: "Remote", hostname: "db.example.com" } as const;
    // @ts-expect-error Remote の DB は、host の照合も印の確認も通っていない
    const prepareRemote = () => prepareNonProductionTables(remote);

    expect(prepareRemote).toBeFunction();
  });
});
