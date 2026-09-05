// server と共通画面 SPA が共有する MFA の wire 語彙と 6 endpoint の request/response の形の正本。
// SPA バンドルが @core alias で直接 import するため、runtime 依存ゼロ (型と const のみ) を保つこと。

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

export type MfaWireErrorCode = (typeof MFA_WIRE_ERROR_CODES)[number];

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

// use-case 由来の error envelope。guard 層の envelope は membership/guard/errors.ts が正本で本型の外 —
// そこから MFA route に到達する code (unauthorized / invalid_argument) だけ wire 語彙側に含める。
export type MfaErrorResponse = { error: MfaWireErrorCode };

// `satisfies z.ZodType<T>` は片方向で optional の欠落も必須の追加も検出しないため、
// request schema の shape 一致はこちらで双方向に縛る。
export type MatchesWireShape<A, B> = [A, keyof A] extends [B, keyof B]
  ? [B, keyof B] extends [A, keyof A]
    ? true
    : never
  : never;

// enrollment_id は必須 (旧 SPA 互換の第 1 段階は終了 — ADR-0016 §5.4)。
export type MfaActivateRequest = { code: string; enrollment_id: string };

export type MfaDisableRequest = { code: string; kind: MfaCodeKind };

// disable と challenge verify は今は同形だが、endpoint ごとに独立して進化するため別宣言にする。
export type MfaChallengeVerifyRequest = { code: string; kind: MfaCodeKind };
