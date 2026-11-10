import { join } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { db } from "../client";

const migrationCount = (): number =>
  readMigrationFiles({ migrationsFolder: join(import.meta.dir, "..", "..", "drizzle") }).length;

export async function unappliedMigrationCount(): Promise<number> {
  const { rows: tables } = await db.execute<{ present: boolean }>(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  if (tables[0]?.present !== true) {
    return migrationCount();
  }
  const { rows } = await db.execute<{ applied: number }>(
    sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`,
  );
  return migrationCount() - (rows[0]?.applied ?? 0);
}
