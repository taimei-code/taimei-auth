export const RELEASE_USAGE =
  "usage: bun run management/release-mfa-registration-guard.ts <userId> --reason <text> --process-stopped-confirmed" as const;

export function parseReleaseArgs(
  argv: string[],
):
  | { userId: string; reason: string; processStoppedConfirmed: boolean }
  | { error: typeof RELEASE_USAGE } {
  const [userId, ...rest] = argv;
  const reasonIndex = rest.indexOf("--reason");
  const reason = reasonIndex >= 0 ? rest[reasonIndex + 1] : undefined;
  if (!userId || userId.startsWith("--") || !reason || reason.startsWith("--")) {
    return { error: RELEASE_USAGE };
  }
  // 消費されない token は usage エラーにする。許すと、引用符を忘れた reason
  // (--reason incident 999) が黙って先頭 1 語に切り詰められ、audit に不完全な理由が残る —
  // 正確な理由の記帳がこのコマンドが儀式的な引数を要求する眼目。
  const leftover = rest.filter(
    (token, index) =>
      index !== reasonIndex && index !== reasonIndex + 1 && token !== "--process-stopped-confirmed",
  );
  if (leftover.length > 0) {
    return { error: RELEASE_USAGE };
  }
  return {
    userId,
    reason,
    processStoppedConfirmed: rest.includes("--process-stopped-confirmed"),
  };
}
