import {
  MFA_WIRE_ERROR_CODES,
  type MfaActivateRequest,
  type MfaChallengeStateResponse,
  type MfaChallengeVerifyRequest,
  type MfaChallengeVerifyResponse,
  type MfaCodeKind,
  type MfaDisableRequest,
  type MfaEnrollResponse,
  type MfaStatusResponse,
  type MfaClientFacingErrorCode,
} from "@core/mfa/client-facing-contracts";

export type { MfaCodeKind } from "@core/mfa/client-facing-contracts";

export type MfaStatus = {
  enabled: boolean;
  recoveryCodesRemaining: number;
};

// recoveryCodes を本人に渡せるのはこの応答だけ (有効化後は残数しか取れない)。画面より先へ持ち出さない
export type MfaEnrollment = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

export type MfaChallengeState = MfaChallengeStateResponse;

export type MfaChallengePassed = { redirectUrl: string };

export type MfaErrorCode = MfaClientFacingErrorCode | "rate_limited" | "unknown";

const CLIENT_FACING_ERROR_CODES: ReadonlySet<string> = new Set(MFA_WIRE_ERROR_CODES);

// ロックアウトと rate limit は同じ 429 なので body の error コードで判別する
const resolveMfaErrorCode = (
  status: number,
  clientFacingError: string | undefined,
): MfaErrorCode => {
  if (clientFacingError !== undefined && CLIENT_FACING_ERROR_CODES.has(clientFacingError))
    return clientFacingError as MfaErrorCode;
  if (status === 429) return "rate_limited";
  return "unknown";
};

class MfaApiError extends Error {
  constructor(public readonly code: MfaErrorCode) {
    super("多要素認証 (MFA) の操作に失敗しました。");
    this.name = "MfaApiError";
  }
}

export const mfaErrorCodeOf = (error: unknown): MfaErrorCode =>
  error instanceof MfaApiError ? error.code : "unknown";

const asRecord = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;

function readClientFacingError(body: unknown): string | undefined {
  const error = asRecord(body)?.error;
  return typeof error === "string" ? error : undefined;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  // credentials を外すとローテート後の session の Set-Cookie を受け取れず、操作直後にログアウトする
  const res = await fetch(url, { credentials: "include", ...init });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new MfaApiError(resolveMfaErrorCode(res.status, readClientFacingError(body)));
  return body;
}

const postJson = (url: string, body?: unknown): Promise<unknown> =>
  requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const requireRecord = (body: unknown): Record<string, unknown> => {
  const record = asRecord(body);
  if (record === null) throw new MfaApiError("unknown");
  return record;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// satisfies は契約に必須 field が増えた時に型エラーで知らせる
const readMfaStatus = (body: unknown): MfaStatus => {
  const record = requireRecord(body);
  if (typeof record.enabled !== "boolean" || typeof record.recovery_codes_remaining !== "number")
    throw new MfaApiError("unknown");
  const checked = {
    enabled: record.enabled,
    recovery_codes_remaining: record.recovery_codes_remaining,
  } satisfies MfaStatusResponse;
  return {
    enabled: checked.enabled,
    recoveryCodesRemaining: checked.recovery_codes_remaining,
  };
};

// 空の totp_uri は QR も secret も無い scan 画面に、空の recovery_codes は復旧手段の無い有効化になる
const readMfaEnrollment = (body: unknown): MfaEnrollment => {
  const record = requireRecord(body);
  if (
    typeof record.enrollment_id !== "string" ||
    record.enrollment_id === "" ||
    typeof record.totp_uri !== "string" ||
    record.totp_uri === "" ||
    !isStringArray(record.recovery_codes) ||
    record.recovery_codes.length === 0
  ) {
    throw new MfaApiError("unknown");
  }
  const checked = {
    enrollment_id: record.enrollment_id,
    totp_uri: record.totp_uri,
    recovery_codes: record.recovery_codes,
  } satisfies MfaEnrollResponse;
  return {
    enrollmentId: checked.enrollment_id,
    totpUri: checked.totp_uri,
    recoveryCodes: checked.recovery_codes,
  };
};

const readMfaChallengeState = (body: unknown): MfaChallengeState => {
  const record = requireRecord(body);
  if (typeof record.pending !== "boolean") throw new MfaApiError("unknown");
  return { pending: record.pending } satisfies MfaChallengeStateResponse;
};

// 空文字を通すと assign("") が現在の URL へ再遷移する
const readMfaChallengePassed = (body: unknown): MfaChallengePassed => {
  const record = requireRecord(body);
  if (typeof record.redirect_url !== "string" || record.redirect_url === "") {
    throw new MfaApiError("unknown");
  }
  const checked = { redirect_url: record.redirect_url } satisfies MfaChallengeVerifyResponse;
  return { redirectUrl: checked.redirect_url };
};

export const getMfaStatus = (): Promise<MfaStatus> =>
  requestJson("/api/account/mfa").then(readMfaStatus);

export const enrollMfa = (): Promise<MfaEnrollment> =>
  postJson("/api/account/mfa/enroll").then(readMfaEnrollment);

export const activateMfa = (input: { code: string; enrollmentId: string }): Promise<void> =>
  postJson("/api/account/mfa/activate", {
    code: input.code,
    enrollment_id: input.enrollmentId,
  } satisfies MfaActivateRequest).then(() => undefined);

export const disableMfa = (input: { code: string; kind: MfaCodeKind }): Promise<void> =>
  postJson("/api/account/mfa/disable", {
    code: input.code,
    kind: input.kind,
  } satisfies MfaDisableRequest).then(() => undefined);

export const getMfaChallenge = (signal?: AbortSignal): Promise<MfaChallengeState> =>
  requestJson("/api/mfa/challenge", { signal }).then(readMfaChallengeState);

export const verifyMfaChallenge = (input: {
  code: string;
  kind: MfaCodeKind;
}): Promise<MfaChallengePassed> =>
  postJson("/api/mfa/challenge/verify", {
    code: input.code,
    kind: input.kind,
  } satisfies MfaChallengeVerifyRequest).then(readMfaChallengePassed);
