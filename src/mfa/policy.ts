export function isMfaEnabled(
  row: { verifiedAt: Date | null } | undefined,
): row is { verifiedAt: Date } {
  return row !== undefined && row.verifiedAt !== null;
}
