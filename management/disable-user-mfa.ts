// MFA 運用救済 CLI (位置づけと手順: ADR-0016 §8.1 / README.md の運用節)。
//   bun run management/disable-user-mfa.ts <userId>
// 1 tx で mfa_totp 行とリカバリーコードを全削除する。guard 参加・protocol 照合は存在しない (ADR-0016)。
import { recordMfaDisabled } from "../db/repositories/audit-log";
import { deleteMfaTotp, deleteRecoveryCodesByUserId } from "../db/repositories/mfa-totp";
import { findUserById } from "../db/repositories/user";
import { runInTransaction } from "../db/transaction";
import { captureAuditLogError } from "../src/audit-error";
import { notifyMfaDisabledForManagement } from "../src/mfa/notification-adapter";

export type ForceDisableResult =
  | { ok: false; error: "not_found" }
  | { ok: true; changed: false }
  | { ok: true; changed: true; notified: boolean };

export async function forceDisableMfa(userId: string): Promise<ForceDisableResult> {
  const user = await findUserById(userId);
  if (!user) return { ok: false, error: "not_found" };

  const deleted = await runInTransaction(async (tx) => {
    const rows = await deleteMfaTotp(userId, tx);
    await deleteRecoveryCodesByUserId(userId, tx);
    return rows;
  });
  if (deleted === 0) return { ok: true, changed: false };

  // 記帳は best-effort — 救済の成立 (行削除) を audit 失敗で取り消さない。
  await recordMfaDisabled({
    user_id: userId,
    ip: null,
    userAgent: "management/disable-user-mfa",
  }).catch((error: unknown) => captureAuditLogError("mfa_disabled", error));
  const notified = await notifyMfaDisabledForManagement(user.email);
  return { ok: true, changed: true, notified };
}

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
    return { stream: "stderr", exitCode: 1, body: { userId, error: result.error } };
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

  const report = toDisableUserMfaReport(userId, await forceDisableMfa(userId));
  const json = JSON.stringify(report.body, null, 2);
  if (report.stream === "stdout") console.log(json);
  else console.error(json);
  // pg pool が開いたままだと process が終了しないため明示 exit する。
  process.exit(report.exitCode);
}
