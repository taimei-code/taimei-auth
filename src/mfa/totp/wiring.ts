import { appendAuditLog, recordMfaDisabled, recordMfaEnabled } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../../audit-error";
import { getAppName } from "../../email/client";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { issueSessionFor, revokeOtherSessions } from "../gateway";
import { notifyMfaDisabled, notifyMfaEnabled } from "../notification-adapter";
import { createMfaActivation } from "./activate-mfa";
import { parseMfaKeyRing, type MfaKeyRing } from "./cipher";
import { createLoginChallengeCompletion } from "./complete-login-challenge";
import { createMfaDisable } from "./disable-mfa";
import { createMfaEnrollment } from "./enroll-mfa";
import type { SessionControl } from "./ports";

// production 結線 (A-11)。gateway 名 (revokeOtherSessions / issueSessionFor) の出現はこのファイルに閉じる。

// 鍵 ring は env から遅延解決する — import 時に throw させない (kill-switch と同じ方針)。
let cached: MfaKeyRing | undefined;
const ring = (): MfaKeyRing => (cached ??= parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS));

const sessions: SessionControl = {
  revokeOthers: async (headers) => {
    const revoked = await revokeOtherSessions(headers);
    return revoked.ok ? { ok: true, headers: revoked.headers } : revoked;
  },
};

export const enrollOperation = createMfaEnrollment({ ring, issuer: getAppName });

export const activateOperation = createMfaActivation({
  ring,
  sessions,
  writeAudit: (input) =>
    recordMfaEnabled({ user_id: input.userId, ip: input.ip, userAgent: input.userAgent }),
  observeAuditError: (error) => captureAuditLogError("mfa_enabled", error),
  notifyEnabled: notifyMfaEnabled,
});

export const disableOperation = createMfaDisable({
  ring,
  sessions,
  writeAudit: (input) =>
    recordMfaDisabled({ user_id: input.userId, ip: input.ip, userAgent: input.userAgent }),
  observeAuditError: (error) => captureAuditLogError("mfa_disabled", error),
  notifyDisabled: notifyMfaDisabled,
  spendAttempt: spendDisableAttempt,
  resetAttempts: resetDisableAttempts,
});

// sign_in audit は通過手続が記帳する (§4.6) — plugin verify 経路が消え observer の completion
// matcher は存在しないため。method はチャレンジ発行時に控えた値。
export const completeLoginChallengeOperation = createLoginChallengeCompletion({
  ring,
  issueSession: issueSessionFor,
  writeSignInAudit: ({ userId, method, ip, userAgent }) =>
    appendAuditLog({ eventType: "sign_in", userId, payload: { method, ip, userAgent } }),
  observeAuditError: (error) => captureAuditLogError("sign_in", error),
});
