// server と共通画面 SPA が HTTP 越しに共有する MFA の wire 語彙と、6 endpoint の request/response
// の形の正本。server handler は satisfies、SPA (mfa-api) は import で同じ型に縛る。SPA バンドルが
// @core alias で直接 import するため、runtime 依存ゼロ (型と const のみ) を保つこと。

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
  "temporarily_unavailable",
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

// use-case 由来の error envelope。guard 層 (requireActor / parseZodBody) の envelope は
// membership/guard/respond.ts が正本で本型の外 — そちらから MFA route に到達する code
// (unauthorized / invalid_argument) は wire 語彙側に含めて一致を保っている。
export type MfaErrorResponse = { error: MfaWireErrorCode };

// zod schema と wire 型の双方向 shape 一致。`satisfies z.ZodType<T>` は片方向で、optional field の
// 欠落も必須 field の追加も検出しないため、request schema はこちらで縛る。
export type MatchesWireShape<A, B> = [A, keyof A] extends [B, keyof B]
  ? [B, keyof B] extends [A, keyof A]
    ? true
    : never
  : never;

// enrollment_id が optional なのは移行第 1 段階の旧 SPA 互換 (ADR-0013 §8)。第 2 段階で必須化する。
export type MfaActivateRequest = { code: string; enrollment_id?: string };

// disable と challenge verify は今は同形だが、endpoint ごとに独立して進化するため別宣言にする。
export type MfaDisableRequest = { code: string; kind: MfaCodeKind };

export type MfaChallengeVerifyRequest = { code: string; kind: MfaCodeKind };
