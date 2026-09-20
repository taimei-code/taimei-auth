// 既定は dry-run、`--execute` で実削除 (削除した user_id を全件ログ)。
import { backfillOrphanCleanup } from "../src/account/backfill-orphan-cleanup";
import { initAuth } from "../src/auth";
import { getRuntime } from "../src/runtime";

initAuth(getRuntime());
const execute = process.argv.includes("--execute");
const report = await getRuntime().runPromise(backfillOrphanCleanup({ execute }));
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", ...report }, null, 2));
process.exit(0);
