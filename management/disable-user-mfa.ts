// MFA 運用救済 CLI (位置づけと手順: ADR-0016 §8.1 / README.md の運用節)。
//   bun run management/disable-user-mfa.ts <userId>
// 1 tx で mfa_totp 行とリカバリーコードを全削除する。guard 参加・protocol 照合は存在しない (ADR-0016)。
import { Effect } from "effect";
import { UserRepo } from "../src/account/ports";
import { AuditLog } from "../src/audit/ports";
import { swallowAuditFailure } from "../src/audit/report-failure";
import { notifyMfaDisabledForManagement } from "../src/mfa/notification-adapter";
import { MfaTotpRepo } from "../src/mfa/totp/ports";
import { getRuntime } from "../src/runtime";
import { Transaction } from "../src/transaction";

// CLI の出力形 (wire ではない)。失敗 class ではなく Result のまま持つのは toDisableUserMfaReport が
// stream / exit code / JSON キーへ写す純関数だから。
export type ForceDisableResult =
  | { ok: false; error: "not_found" }
  | { ok: true; changed: false }
  | { ok: true; changed: true; notified: boolean };

export const forceDisableMfa = Effect.fn("management.forceDisableMfa")(function* (userId: string) {
  const users = yield* UserRepo;
  const audit = yield* AuditLog;
  const mfa = yield* MfaTotpRepo;
  const tx = yield* Transaction;

  const user = yield* users.findById(userId);
  if (!user) return { ok: false, error: "not_found" } satisfies ForceDisableResult;

  const deleted = yield* tx.run((t) =>
    Effect.gen(function* () {
      const rows = yield* mfa.deleteMfaTotp(userId, t);
      yield* mfa.deleteRecoveryCodesByUserId(userId, t);
      return rows;
    }),
  );
  if (deleted === 0) return { ok: true, changed: false } satisfies ForceDisableResult;

  // 記帳は best-effort — 救済の成立 (行削除) を audit 失敗で取り消さない。
  yield* audit
    .recordMfaDisabled({ user_id: userId, ip: null, userAgent: "management/disable-user-mfa" })
    .pipe(swallowAuditFailure("mfa_disabled"));
  const notified = yield* notifyMfaDisabledForManagement(user.email);
  return { ok: true, changed: true, notified } satisfies ForceDisableResult;
});

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

  // use-case は Effect (ADR-0017)。CLI も app と同じ runtime (AppLayer) で走らせ、live ports を共有する。
  const report = toDisableUserMfaReport(
    userId,
    await getRuntime().runPromise(forceDisableMfa(userId)),
  );
  const json = JSON.stringify(report.body, null, 2);
  if (report.stream === "stdout") console.log(json);
  else console.error(json);
  // pg pool が開いたままだと process が終了しないため明示 exit する。
  process.exit(report.exitCode);
}
