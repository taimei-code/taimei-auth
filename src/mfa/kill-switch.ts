// 未設定は on (fail-safe)。
export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
