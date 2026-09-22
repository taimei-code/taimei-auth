// "false" のときだけ off にする fail-safe な既定。
export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
