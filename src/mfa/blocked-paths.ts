// 遮断する better-auth twoFactor プラグインの生 path カタログ (全遮断の判断: ADR-0013 §1)。
// 8 件なのは generateTOTP / viewBackupCodes が serverOnly で path を持たないため (一致は網羅テストが固定)。
export const RAW_TWO_FACTOR_PATHS = [
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-totp",
] as const satisfies readonly string[];

export type RawTwoFactorPath = (typeof RAW_TWO_FACTOR_PATHS)[number];
