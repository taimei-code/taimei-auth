// MFA チャレンジ要否の述語 kernel (I/O なし)。表示とチャレンジ要否の判定二重化を防ぐため、
// src/mfa/ の他ファイルで verified_at を直接比較しない (規律の正本: ADR-0016)。
// 入力は mfa_totp 行の最小射影 (db/repositories/mfa-totp.ts の readMfaVerification)。
// 行なし (undefined) = 未登録、verifiedAt NULL = 登録済み未有効 — どちらもチャレンジ不要。
export function requiresMfaChallenge(enrollment: { verifiedAt: Date | null } | undefined): boolean {
  return enrollment !== undefined && enrollment.verifiedAt !== null;
}
