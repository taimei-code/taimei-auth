// 結果不明のまま残った guard は「古いから」では解除しない (ADR-0013 §8: 自動 TTL を持たない理由)。
// このコマンドが冗長な引数を要求するのは意図的で、運用者が先行 process の停止を確認したことと
// audit に残す理由の両方を明示させる。
//
// bun run management/release-mfa-registration-guard.ts <userId> \
//   --reason "incident reference" --process-stopped-confirmed
import { forceReleaseRegistrationGuard } from "../src/mfa/registration/management";

const userId = process.argv[2];
const reasonIndex = process.argv.indexOf("--reason");
const reason = reasonIndex >= 0 ? process.argv[reasonIndex + 1] : undefined;
const processStoppedConfirmed = process.argv.includes("--process-stopped-confirmed");

// フラグ順の取り違え (`--reason` の直後に別フラグ / userId の位置にフラグ) を弾く。素通しすると
// audit の reason にフラグ名が記録されたり、userId="--reason" で 0 行削除・exit 0 になり、
// 「解除済み」と誤認したまま user が 503 に残る。
if (!userId || userId.startsWith("--") || !reason || reason.startsWith("--")) {
  console.error(
    "usage: bun run management/release-mfa-registration-guard.ts <userId> --reason <text> --process-stopped-confirmed",
  );
  process.exit(1);
}

const result = await forceReleaseRegistrationGuard({
  userId,
  source: "management/release-mfa-registration-guard",
  reason,
  processStoppedConfirmed,
});

if (!result.ok) {
  console.error(JSON.stringify({ userId, error: result.reason }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ userId, released: result.released }, null, 2));
process.exit(0);
