import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// Workers (workerd) は「ある request の I/O コンテキストで開いた socket を別 request で再利用できない」ため、
// module singleton の Pool を使い回すと 2 回目以降の query が resolve も reject もせず "Worker hung" になる
// (= /auth/ で findMembershipsByUserId が毎回ハングしていた真因。PR #87〜)。
// Cloudflare 公式の node-postgres + Hyperdrive 方針は「handler 内で request ごとに Pool を生成し
// ctx.waitUntil(pool.end()) で閉じる」。一方 repository 群 / better-auth drizzleAdapter は単一の `db` を
// import するので、db インスタンス自体は module ロード時に 1 度だけ構築し、drizzle に渡す Pool 実体だけを
// request 単位に差し替える RoutingPool を噛ませる。実 Pool は ALS (AsyncLocalStorage) に載せ、worker entry が
// runWithRequestPool で set し、background DB 書き込み (audit log) 完走後に pool.end() する。
// Bun / Node (compose / テスト / CLI) は長命プロセスなので singletonPool を共有する。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
const requestPoolStore = new AsyncLocalStorage<Pool>();
let singletonPool: Pool | undefined;

// Workers: ALS の request pool を返す。Bun/Node: singletonPool にフォールバック。
// どちらも未設定なら初期化呼び忘れとして throw する。
function currentPool(): Pool {
  const pool = requestPoolStore.getStore() ?? singletonPool;
  if (!pool) {
    throw new Error(
      "DB pool is not initialized: call initDb() (Bun/Node) or runWithRequestPool() (Workers) first",
    );
  }
  return pool;
}

// drizzle に渡す前段。query / connect を「その時点の」request pool (Workers) か singletonPool (Bun) へ委譲する。
// drizzle は transaction 時に `this.client instanceof Pool` で pool 判定し、pool なら connect() で 1 接続を
// pin する (drizzle-orm 0.45 node-postgres session.cjs:216、実機確認済み)。満たさないと BEGIN/COMMIT が
// 別接続に散り advisory lock / FOR UPDATE の atomicity が壊れる。Pool を extends することで instanceof を
// 自然に満たし (object 全体の cast 不要)、query / connect だけ currentPool() への委譲で上書きする
// (このインスタンス自身は実接続を持たない)。委譲関数の `as Pool[...]` は引数を 1:1 転送するだけの局所 cast。
class RoutingPool extends Pool {
  override query = ((...args: Parameters<Pool["query"]>) =>
    currentPool().query(...args)) as Pool["query"];
  override connect = ((...args: Parameters<Pool["connect"]>) =>
    currentPool().connect(...args)) as Pool["connect"];
}

// repository 群 / transaction.ts / better-auth drizzleAdapter が import する単一インスタンス。
export const db: Db = drizzle(new RoutingPool(), { schema });

// Bun / Node: connectionString から singleton pool を 1 度だけ構築する。
export function initDb(connectionString: string): void {
  if (singletonPool) return;
  singletonPool = new Pool({ connectionString });
}

// Workers: request ごとに実 Pool を作り ALS に載せて fn を実行する。
// 戻り値の pool を呼び出し側 (src/worker.ts) が background task 完走後に ctx.waitUntil(pool.end()) で閉じる。
// max:5 は Workers の同時外部接続上限 (Cloudflare 公式)。
export function runWithRequestPool<T>(connectionString: string, fn: (pool: Pool) => T): T {
  const pool = new Pool({ connectionString, max: 5 });
  return requestPoolStore.run(pool, () => fn(pool));
}

// Bun / Node: 接続文字列が env にあれば即 init。Workers では DATABASE_URL が未設定のため skip し、
// worker entry (src/worker.ts) が request ごとに runWithRequestPool で実 Pool を供給する。
if (typeof process !== "undefined" && process.env?.DATABASE_URL) {
  initDb(process.env.DATABASE_URL);
}
