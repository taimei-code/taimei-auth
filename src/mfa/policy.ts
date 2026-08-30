// MFA チャレンジ要否の述語 kernel (I/O なし)。表示とチャレンジ要否の判定二重化を防ぐため、
// src/mfa/ の他ファイルで twoFactorEnabled を直接比較しない (規律の正本: ADR-0013 §7)。
// two_factor 行を読まず 1 フラグで判定するのは、全ログインが通る経路で pg 往復を増やさないため。
// 成立の根拠は不変条件「twoFactorEnabled: true ⇒ verified な two_factor 行」(論拠: db/schema.ts)。
export function requiresMfaChallenge(user: { twoFactorEnabled: boolean }): boolean {
  return user.twoFactorEnabled;
}
