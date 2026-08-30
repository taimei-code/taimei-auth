// MFA 運用救済 CLI (位置づけと手順: ADR-0013 Consequences / README.md の運用節)。
//   bun run management/disable-user-mfa.ts <userId>
// 解除・記帳・通知は bound management application が所有し、ここは引数の解釈と結果の報告に徹する。
import { managementApplication } from "../src/mfa/registration/wiring";

type ForceDisableResult = Awaited<ReturnType<typeof managementApplication.forceDisable>>;

type DisableUserMfaReport = {
  stream: "stdout" | "stderr";
  exitCode: 0 | 1;
  body: Record<string, unknown>;
};

// 結果 → 出力の写像を純関数に切り出し、stream / exit code / JSON キーを直接検証可能にする。
export function toDisableUserMfaReport(
  userId: string,
  result: ForceDisableResult,
): DisableUserMfaReport {
  if (!result.ok) {
    return {
      stream: "stderr",
      exitCode: 1,
      body: {
        userId,
        error: result.error,
        // busy だけ additive に載せる。運用者が待つべき秒数を出力から読める状態にする。
        ...(result.error === "temporarily_unavailable"
          ? { retryAfterSeconds: result.retryAfterSeconds }
          : {}),
      },
    };
  }

  // 既に無効なら何も変えずに成功で返す。再実行が「失敗」に見えると不要な次の手 (DB 直接操作等) を踏ませる。
  if (!result.changed) {
    return {
      stream: "stdout",
      exitCode: 0,
      body: { userId, changed: false, reason: "mfa_not_enabled" },
    };
  }

  return {
    stream: "stdout",
    exitCode: 0,
    body: { userId, changed: true, notified: result.notified },
  };
}

if (import.meta.main) {
  const userId = process.argv[2];
  if (!userId) {
    console.error("usage: bun run management/disable-user-mfa.ts <userId>");
    process.exit(1);
  }

  const report = toDisableUserMfaReport(userId, await managementApplication.forceDisable(userId));
  const json = JSON.stringify(report.body, null, 2);
  if (report.stream === "stdout") console.log(json);
  else console.error(json);
  // pg pool が開いたままだと process が終了しないため明示 exit する。
  process.exit(report.exitCode);
}
