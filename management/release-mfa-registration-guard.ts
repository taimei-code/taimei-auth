// 結果不明の guard は「古いから」では解除しない (自動 TTL を持たない理由: ADR-0013 §8)。冗長な引数は
// 意図的で、先行 process の停止確認と audit に残す理由の両方を運用者に明示させる。
// bun run management/release-mfa-registration-guard.ts <userId> \
//   --reason "incident reference" --process-stopped-confirmed
import { managementApplication } from "../src/mfa/registration/wiring";
import { parseReleaseArgs } from "./release-args";

// フラグ順の取り違えを弾く。素通しすると audit の reason にフラグ名が入ったり、userId="--reason" で
// 0 行削除・exit 0 になり「解除済み」と誤認したまま user が 503 に残る。
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
  // 「解除済み」と誤認したまま去り、実際の user は 503 に残る。
  // pg pool が開いたままだと process が終了しないため、いずれの場合も明示 exit する。
  process.exit(result.released ? 0 : 1);
}
