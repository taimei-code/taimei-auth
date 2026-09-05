// ADR-0010 PR-4: D1 導入前に soft delete された事業所に残る ghost membership と、放置された orphan
// アカウントを掃除する one-shot backfill。rollback 不能な物理削除のため 2 段階で運用する:
//   bun run management/backfill-orphan-cleanup.ts            # dry-run: 削除対象 (件数 + user_id) を表示するだけ
//   bun run management/backfill-orphan-cleanup.ts --execute  # 実削除 (削除した user_id を全件ログ)
import { backfillOrphanCleanup } from "../src/account/backfill-orphan-cleanup";
import { getRuntime } from "../src/runtime";

const execute = process.argv.includes("--execute");
// use-case は Effect (ADR-0017)。CLI も app と同じ runtime (AppLayer) で走らせ、live ports を共有する。
const report = await getRuntime().runPromise(backfillOrphanCleanup({ execute }));
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", ...report }, null, 2));
// pg pool が開いたままだと process が終了しないため明示 exit する。
process.exit(0);
