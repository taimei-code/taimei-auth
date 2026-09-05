// ADR-0010 D5: 登録途中放棄アカウント (TTL 内に事業所を作らなかった 0 件アカウント) を削除する定期 sweep。
// デプロイ側のスケジューラから日次で実行する想定 (本 repo はスケジューラ基盤を持たない)。
//   bun run management/sweep-abandoned-signups.ts            # dry-run: 候補を表示するだけ
//   bun run management/sweep-abandoned-signups.ts --execute  # 実削除 (削除した user_id を全件ログ)
// TTL は SWEEP_TTL_HOURS env で上書き可 (既定 24h)。
import { sweepAbandonedSignups } from "../src/account/sweep-abandoned-signups";
import { getRuntime } from "../src/runtime";

const execute = process.argv.includes("--execute");
const ttlHours = Number(process.env.SWEEP_TTL_HOURS ?? "24");
// use-case は Effect (ADR-0017)。CLI も app と同じ runtime (AppLayer) で走らせ、live ports を共有する。
const report = await getRuntime().runPromise(
  sweepAbandonedSignups({ olderThanMs: ttlHours * 60 * 60 * 1000, execute }),
);
console.log(
  JSON.stringify({ mode: execute ? "execute" : "dry-run", ttlHours, ...report }, null, 2),
);
// pg pool が開いたままだと process が終了しないため明示 exit する。
process.exit(0);
