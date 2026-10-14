export function isMfaChallengeEnabled(raw: string | undefined): boolean {
  return raw !== "false";
}
