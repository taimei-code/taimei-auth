import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// Workers は別 request の I/O コンテキストで開いた socket を再利用できず、singleton Pool を使い回すと
// query が "Worker hung" になる。db は module ロード時に 1 度だけ構築し Pool 実体だけを ALS 経由で
// request 単位に差し替える (Bun / Node は長命プロセスなので singletonPool を共有)。
// 詳細: db/CLAUDE.md の gotcha / ADR-0011 / PR #91
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

// drizzle に渡す前段。query / connect を request pool (Workers) か singletonPool (Bun) へ委譲する。
// `extends Pool` は drizzle の `instanceof Pool` 判定を満たすために必須 (詳細: db/CLAUDE.md の gotcha)。
class RoutingPool extends Pool {
  override query = ((...args: Parameters<Pool["query"]>) =>
    requireCurrentPool().query(...args)) as Pool["query"];
  override connect = ((...args: Parameters<Pool["connect"]>) =>
    requireCurrentPool().connect(...args)) as Pool["connect"];
}

export const db: Db = drizzle(new RoutingPool(), { schema });

// Bun / Node: connectionString から singleton pool を 1 度だけ構築する。
export function initDb(connectionString: string): void {
  if (singletonPool) return;
  singletonPool = new Pool({ connectionString });
}

// Workers: request ごとに実 Pool を作り ALS に載せる。戻り値の pool は呼び出し側 (src/worker.ts) が
// background task 完走後に ctx.waitUntil(pool.end()) で閉じる。max:5 は Workers の同時外部接続上限。
export function runWithRequestPool<T>(connectionString: string, fn: (pool: Pool) => T): T {
  const pool = new Pool({ connectionString, max: 5 });
  return requestPoolStore.run(pool, () => fn(pool));
}

// Bun / Node は env にあれば即 init (Workers は DATABASE_URL 未設定で skip し worker entry が供給する)。
if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
}
