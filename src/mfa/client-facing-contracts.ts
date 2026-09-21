// SPA バンドルが直接 import するため、runtime 依存ゼロ (型と const のみ) を保つこと。

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

// guard 層の envelope は membership/guard/errors.ts が正本 — MFA route に届く 2 コードだけ含める。
export type MfaErrorResponse = { error: MfaClientFacingErrorCode };

// `satisfies z.ZodType<T>` は片方向で optional の欠落を検出しないため、こちらで双方向に縛る。
export type MatchesClientFacingShape<A, B> = [A, keyof A] extends [B, keyof B]
  ? [B, keyof B] extends [A, keyof A]
    ? true
    : never
  : never;

export type MfaActivateRequest = { code: string; enrollment_id: string };

export type MfaDisableRequest = { code: string; kind: MfaCodeKind };

// disable と challenge verify は今は同形だが、独立して進化するため別宣言にする。
export type MfaChallengeVerifyRequest = { code: string; kind: MfaCodeKind };
