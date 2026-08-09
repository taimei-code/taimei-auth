// ブラウザからの到達を遮断する better-auth twoFactor プラグインの生 path カタログ。
// 遮断の設計判断 (自前 REST だけを表面にする) は docs/adr/0013-mfa-totp-challenge.md。
//
// verify 系も含めて全遮断するのは、自前 POST を迂回されると sign_in audit の記帳と
// チャレンジ状態の掃除がまとめてバイパスされるため。
//
// 8 件なのは、プラグインの endpoint のうち generateTOTP / viewBackupCodes が serverOnly
// (@better-auth/core の createAuthEndpoint.serverOnly) で HTTP router に登録されず path を
// 持たないから。この 8 件とプラグイン側の path 付き endpoint の一致は網羅テストが固定する。
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
