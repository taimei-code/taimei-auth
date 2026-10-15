import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db, runWithRequestPool } from "../client";

const backendPid = async (run: typeof db.execute) => {
  const result = await run(sql`SELECT pg_backend_pid() AS pid`);
  return (result.rows[0] as { pid: number }).pid;
};

describe("db の RoutingPool は drizzle に pool と認識される", () => {
  test("request ごとの pool でも、transaction の中で同時に投げた query もすべて同じ接続で走る (drizzle は pool でない client だと BEGIN と COMMIT を別の接続に送る)", async () => {
    const connectionString = process.env.DATABASE_URL ?? "";
    expect(connectionString).not.toBe("");

    const pids = await runWithRequestPool(connectionString, async (pool) => {
      try {
        return await db.transaction((tx) =>
          Promise.all([1, 2, 3].map(() => backendPid((query) => tx.execute(query)))),
        );
      } finally {
        await pool.end();
      }
    });

    expect(new Set(pids).size).toBe(1);
  });
});
