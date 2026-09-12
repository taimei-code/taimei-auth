// MFA 運用救済 CLI (ロックアウトの唯一の出口。手順: README 運用節)。
import { Effect } from "effect";
import { UserRepo } from "../src/account/ports";
import { appendAuditLogBestEffort } from "../src/audit/report-failure";
import { notifyMfaDisabledForManagement } from "../src/mfa/notification-adapter";
import { isMfaEnabled } from "../src/mfa/policy";
import { MfaTotpRepo } from "../src/mfa/totp/ports";
import { getRuntime } from "../src/runtime";
import { Transaction } from "../src/transaction";

export type ForceDisableResult =
  | { ok: false; error: "not_found" }
  | { ok: true; changed: false }
  | { ok: true; changed: true; notified: boolean };

export const forceDisableMfa = Effect.fn("management.forceDisableMfa")(function* (userId: string) {
  const users = yield* UserRepo;
  const mfa = yield* MfaTotpRepo;
  const tx = yield* Transaction;

  const user = yield* users.findUserById(userId);
  if (!user) return { ok: false, error: "not_found" } satisfies ForceDisableResult;
  const wasEnabled = isMfaEnabled(yield* mfa.readMfaVerification(userId));

  const deleted = yield* tx.run(
    Effect.fn("management.forceDisableMfa.apply")(function* (t) {
      const rows = yield* mfa.deleteMfaTotp(userId, t);
      yield* mfa.deleteRecoveryCodesByUserId(userId, t);
      return rows;
    }),
  );
  if (deleted === 0 || !wasEnabled)
    return { ok: true, changed: false } satisfies ForceDisableResult;

  yield* appendAuditLogBestEffort({
    eventType: "mfa_disabled",
    userId,
    payload: { ip: null, userAgent: "management/disable-user-mfa" },
  });
  const notified = yield* notifyMfaDisabledForManagement(user.email);
  return { ok: true, changed: true, notified } satisfies ForceDisableResult;
});

type DisableUserMfaReport = {
  stream: "stdout" | "stderr";
  exitCode: 0 | 1;
  body: Record<string, unknown>;
};

export function toDisableUserMfaReport(
  userId: string,
  result: ForceDisableResult,
): DisableUserMfaReport {
  if (!result.ok) {
    return { stream: "stderr", exitCode: 1, body: { userId, error: result.error } };
  }

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

  const report = toDisableUserMfaReport(
    userId,
    await getRuntime().runPromise(forceDisableMfa(userId)),
  );
  const json = JSON.stringify(report.body, null, 2);
  if (report.stream === "stdout") console.log(json);
  else console.error(json);
  process.exit(report.exitCode);
}
