import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../client";

const repoRoot = join(import.meta.dir, "..", "..");

const runMigrate = (databaseUrl: string) => {
  const result = Bun.spawnSync(["bun", "run", "db:migrate"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
};

const localDatabaseUrl = process.env.DATABASE_URL!;

const appliedMigrationCount = async () =>
  (
    await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
    )
  ).rows[0]?.n;

describe("bun run db:migrate", () => {
  test("DB に接続できない時は、0 以外で終わり接続の失敗の code を出す", () => {
    const { exitCode, output } = runMigrate("postgres://postgres@127.0.0.1:1/auth");
    expect(exitCode).not.toBe(0);
    expect(output).toContain("ECONNREFUSED");
  });

  test("DATABASE_URL が空の時は、0 以外で終わり DATABASE_URL を名指す", () => {
    const { exitCode, output } = runMigrate("");
    expect(exitCode).not.toBe(0);
    expect(output).toContain("set DATABASE_URL");
  });

  test("DB が無い時は、0 以外で終わり Postgres の error code を出す", () => {
    const missingDatabase = new URL(localDatabaseUrl);
    missingDatabase.pathname = "/migrate_test_no_such_database";
    const { exitCode, output } = runMigrate(missingDatabase.toString());
    expect(exitCode).not.toBe(0);
    expect(output).toContain("3D000");
  });

  test("適用済みの DB に流すと、何も適用せず 0 で終わる", async () => {
    const before = await appliedMigrationCount();
    const { exitCode } = runMigrate(localDatabaseUrl);
    expect(exitCode).toBe(0);
    expect(await appliedMigrationCount()).toBe(before);
  });
});
