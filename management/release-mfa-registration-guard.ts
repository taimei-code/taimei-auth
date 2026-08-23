// 結果不明のまま残った guard は「古いから」では解除しない (ADR-0013 §8: 自動 TTL を持たない理由)。
// このコマンドが冗長な引数を要求するのは意図的で、運用者が先行 process の停止を確認したことと
// audit に残す理由の両方を明示させる。
//
// bun run management/release-mfa-registration-guard.ts <userId> \
//   --reason "incident reference" --process-stopped-confirmed
import { managementApplication } from "../src/mfa/registration/wiring";
import { parseReleaseArgs } from "./release-args";

// フラグ順の取り違え (`--reason` の直後に別フラグ / userId の位置にフラグ) を弾く。素通しすると
// audit の reason にフラグ名が記録されたり、userId="--reason" で 0 行削除・exit 0 になり、
// 「解除済み」と誤認したまま user が 503 に残る。
if (import.meta.main) {
  const parsed = parseReleaseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(1);
  }

  const result = await managementApplication.forceReleaseRegistrationGuard({
    userId: parsed.userId,
    source: "management/release-mfa-registration-guard",
    reason: parsed.reason,
    processStoppedConfirmed: parsed.processStoppedConfirmed,
  });

  if (!result.ok) {
    console.error(JSON.stringify({ userId: parsed.userId, error: result.reason }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ userId: parsed.userId, released: result.released }, null, 2));
  // released:false (guard 行なし = userId typo か解除済み) を exit 0 にすると、打ち間違えた運用者が
  // 「解除済み」と誤認したまま去り、実際の user は 503 に残る — header の検証と同じ事故クラス。
  // pg pool が開いたままだと process が終了しないため、いずれの場合も明示 exit する。
  process.exit(result.released ? 0 : 1);
}
