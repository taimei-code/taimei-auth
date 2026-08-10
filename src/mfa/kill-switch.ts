// チャレンジ強制をデプロイ rollback 無しで止める kill switch (MFA_CHALLENGE_ENABLED) の解釈。
// env 値の行列を単体テストで固定できるよう、process.env の読み出しは呼び出し側に残す。
// off は正確に "false" のみ — 設定漏れやタイポで第二要素が黙って消える方向に倒さない
// fail-safe 既定 (詳細: docs/adr/0013-mfa-totp-challenge.md)。
export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
