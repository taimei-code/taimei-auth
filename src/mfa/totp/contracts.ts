// totp モジュールの公開結果型 (A-5)。guard の Actor がそのまま代入できる形に保つ。
// 失敗は成功値の union でなく failure class (src/mfa/error-mapping.ts) が E channel で運ぶ。

export type MfaTotpActor = { id: string; email: string };

export type TotpEnrollmentMaterial = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

// 有効化 / 無効化が呼び出し側へ転送させる Set-Cookie (revoke 由来)。
export type TotpSessionChanges = { sessionChanges: Headers };
