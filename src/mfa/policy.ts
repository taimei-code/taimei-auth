// MFA チャレンジ要否の述語 kernel (I/O なし)。規律 (正本: ADR-0016): 表示 (read-status.ts) とチャレンジ要否
// (challenge-required.ts) の 2 読み手はこの述語を通し、verified_at を直接比較しない (判定二重化の禁止)。
// 遷移の前提条件 (AlreadyEnabled / NotEnabled) は対象外で、各 use-case が自身の失敗語彙で verifiedAt を読む
// (3 状態 module は PR #144 で作り ADR-0016 が削除した。戻さない)。
// 入力は mfa_totp 行の最小射影 (db/repositories/mfa-totp.ts の readMfaVerification)。
// 行なし (undefined) = 未登録、verifiedAt NULL = 登録済み未有効 — どちらもチャレンジ不要。
export function requiresMfaChallenge(enrollment: { verifiedAt: Date | null } | undefined): boolean {
  return enrollment !== undefined && enrollment.verifiedAt !== null;
}
