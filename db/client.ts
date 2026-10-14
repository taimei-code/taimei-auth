import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

const requestPoolStore = new AsyncLocalStorage<Pool>();
let singletonPool: Pool | undefined;

function requireCurrentPool(): Pool {
  const pool = requestPoolStore.getStore() ?? singletonPool;
  if (!pool) {
    throw new Error(
      "DB pool is not initialized: call initDb() (Bun/Node) or runWithRequestPool() (Workers) first",
    );
  }
  return pool;
}

class RoutingPool extends Pool {
  override query = ((...args: Parameters<Pool["query"]>) =>
    requireCurrentPool().query(...args)) as Pool["query"];
  override connect = ((...args: Parameters<Pool["connect"]>) =>
    requireCurrentPool().connect(...args)) as Pool["connect"];
}

export const db: Db = drizzle(new RoutingPool(), { schema });

function initDb(connectionString: string): void {
  if (singletonPool) return;
  singletonPool = new Pool({ connectionString });
}

export function runWithRequestPool<T>(connectionString: string, fn: (pool: Pool) => T): T {
  const pool = new Pool({ connectionString, max: 5 });
  return requestPoolStore.run(pool, () => fn(pool));
}

if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
}
