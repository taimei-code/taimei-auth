// SPA が直接 import するため runtime 依存を持たない (型だけ)。

export type MfaCodeKind = "totp" | "recovery_code";

export type MfaClientFacingErrorCode =
  | "invalid_code"
  | "challenge_expired"
  | "locked"
  | "already_enabled"
  | "enrollment_changed"
  | "not_enabled"
  | "invalid_argument"
  | "unauthorized"
  | "not_found";

// `satisfies z.ZodType<T>` は片方向で optional の欠落を見逃すため双方向に強制する。
export type MatchesClientFacingShape<A, B> = [A, keyof A] extends [B, keyof B]
  ? [B, keyof B] extends [A, keyof A]
    ? true
    : never
  : never;
