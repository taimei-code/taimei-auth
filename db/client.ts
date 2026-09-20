import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// workerd は別 request の I/O コンテキストで開いた socket を再利用できず、使い回すと "Worker hung" になる。
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

// extends Pool は drizzle の instanceof Pool 判定を満たすために必須。
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

// max:5 は Workers の同時外部接続上限。pool を閉じるのは呼び出し側 (src/worker.ts)。
export function runWithRequestPool<T>(connectionString: string, fn: (pool: Pool) => T): T {
  const pool = new Pool({ connectionString, max: 5 });
  return requestPoolStore.run(pool, () => fn(pool));
}

if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
}
