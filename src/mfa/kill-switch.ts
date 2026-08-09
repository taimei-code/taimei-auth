// チャレンジ強制をデプロイ rollback 無しで止める kill switch (MFA_CHALLENGE_ENABLED) の解釈。
// env 値の行列を単体テストで固定できるよう、process.env の読み出しは呼び出し側に残す。
//
// off に倒れるのは正確に "false" のときだけで、未設定 / 空文字 / 綴り違い ("FALSE" / "0" / "off")
// はすべて on とみなす。この非対称な既定により、env の設定漏れやタイポで第二要素が黙って
// 無効化される (= MFA 有効ユーザーが一次認証だけでログインできる) 方向には倒れない。
export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
