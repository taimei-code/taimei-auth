// SPA のバンドルが直接 import するため、runtime 依存を持たない (型と const だけの) 状態を保つ。

export type MfaCodeKind = "totp" | "recovery_code";

export const MFA_WIRE_ERROR_CODES = [
  "invalid_code",
  "challenge_expired",
  "locked",
  "already_enabled",
  "enrollment_changed",
  "not_enabled",
  "invalid_argument",
  "unauthorized",
  "not_found",
] as const;

export type MfaClientFacingErrorCode = (typeof MFA_WIRE_ERROR_CODES)[number];

export type MfaStatusResponse = {
  enabled: boolean;
  in_effect: boolean;
  recovery_codes_remaining: number;
};

export type MfaEnrollResponse = {
  totp_uri: string;
  recovery_codes: string[];
  enrollment_id: string;
};

export type MfaOkResponse = { ok: true };

export type MfaChallengeStateResponse = { pending: boolean };

export type MfaChallengeVerifyResponse = { redirect_url: string };

// guard 層の envelope は membership/guard/errors.ts で定義する。ここには MFA route に届く 2 コードだけを含める。
export type MfaErrorResponse = { error: MfaClientFacingErrorCode };

// `satisfies z.ZodType<T>` は片方向の検査で optional の欠落を検出しないため、ここで双方向に一致を強制する。
export type MatchesClientFacingShape<A, B> = [A, keyof A] extends [B, keyof B]
  ? [B, keyof B] extends [A, keyof A]
    ? true
    : never
  : never;

export type MfaActivateRequest = { code: string; enrollment_id: string };

export type MfaDisableRequest = { code: string; kind: MfaCodeKind };

// disable と challenge verify は今は同じ形だが、それぞれ独立して変わるため別に宣言する。
export type MfaChallengeVerifyRequest = { code: string; kind: MfaCodeKind };
