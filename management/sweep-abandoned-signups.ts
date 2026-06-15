// ADR-0010 D5: 登録途中放棄アカウント (signup でアカウント作成後、TTL 内に事業所を作らなかった
// 所属 0 件アカウント) を削除する定期 sweep。D2 で通常の orphan は即削除されるため、唯一許容する
// 0 件状態 (signup 登録途中) を恒久化させないための安全網。
//
// デプロイ側のスケジューラ (k8s CronJob / cron) から日次で実行する想定 (本 repo はスケジューラ基盤を持たない)。
//   bun run management/sweep-abandoned-signups.ts            # dry-run: 候補を表示するだけ
//   bun run management/sweep-abandoned-signups.ts --execute  # 実削除 (削除した user_id を全件ログ)
// TTL は SWEEP_TTL_HOURS env で上書き可 (既定 24h)。
//
// 設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
import { sweepAbandonedSignups } from "../src/account/sweep-abandoned-signups";

const execute = process.argv.includes("--execute");
const ttlHours = Number(process.env.SWEEP_TTL_HOURS ?? "24");
const report = await sweepAbandonedSignups({ olderThanMs: ttlHours * 60 * 60 * 1000, execute });
console.log(
  JSON.stringify({ mode: execute ? "execute" : "dry-run", ttlHours, ...report }, null, 2),
);
// pg pool が開いたままだと process が終了しないため明示 exit する。
process.exit(0);
