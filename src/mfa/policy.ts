// MFA チャレンジ要否の述語 kernel (src/membership/policy.ts と同じ位置づけ)。I/O を持たない。
// ログイン hot path の判定と、セキュリティページの有効/無効表示が同じ 1 関数を通ることで
// 「画面では有効なのにチャレンジが出ない」型の判定分岐の二重化を構造的に防ぐ。
// src/mfa/ の他ファイルで twoFactorEnabled を直接比較しないこと。
//
// two_factor 行を読まずに user の 1 フラグだけで判定するのは、全ログインが通る経路で
// pg 往復を増やさないため。成立の根拠は不変条件「twoFactorEnabled: true ⇒ verified な
// two_factor 行が存在する」で、その論拠は db/schema.ts の twoFactor テーブル定義コメントにある。
export function requiresMfaChallenge(user: { twoFactorEnabled: boolean }): boolean {
  return user.twoFactorEnabled;
}
