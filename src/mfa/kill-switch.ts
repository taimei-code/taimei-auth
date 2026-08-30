// kill switch (MFA_CHALLENGE_ENABLED) の解釈。off は "false" のみの fail-safe 既定: ADR-0013 Consequences。
// process.env の読み出しを呼び出し側に残すのは、env 値の行列を単体テストで固定するため。
export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
