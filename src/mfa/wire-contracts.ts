// server と共通画面 SPA が HTTP 越しに共有する MFA の wire 語彙。SPA バンドルが @core alias で
// 直接 import するため、runtime 依存ゼロ (型と const のみ) を保つこと。

export type MfaCodeKind = "totp" | "recovery_code";

export const MFA_WIRE_ERROR_CODES = [
  "invalid_code",
  "challenge_expired",
  "locked",
  "already_enabled",
  "enrollment_changed",
  "not_enabled",
  "invalid_argument",
  "unauthorized",
  "not_found",
  "temporarily_unavailable",
] as const;

export type MfaWireErrorCode = (typeof MFA_WIRE_ERROR_CODES)[number];
