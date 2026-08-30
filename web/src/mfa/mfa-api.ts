// SPA → auth ホストの MFA API client。wire (@core/mfa/wire-contracts が正本) を view 形へ変換する唯一の場所で、
// 形の崩れた 2xx は "unknown" へ縮退する。汎用 request と分ける理由: web/src/CLAUDE.md「HTTPとerror」。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

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
  type MfaWireErrorCode,
} from "@core/mfa/wire-contracts";

export type { MfaCodeKind } from "@core/mfa/wire-contracts";

export type MfaStatus = {
  enabled: boolean;
  // two_factor 認証がまだ効いているか。enabled=false でも「中断した無効化」は true になり、
  // その状態の唯一の出口は無効化操作 (enroll は 409 で拒まれる) なので disable を出す判定に使う。
  inEffect: boolean;
  recoveryCodesRemaining: number;
};

// recoveryCodes は登録途中のenroll再実行で同じ値を返す。有効化後は残数しか取得できない。
// 受け取った画面より先へ持ち出さないこと。
export type MfaEnrollment = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

// wire と view が同形の endpoint は wire 型をそのまま view にする。
export type MfaChallengeState = MfaChallengeStateResponse;

export type MfaChallengePassed = { redirectUrl: string };

export type MfaErrorCode = MfaWireErrorCode | "rate_limited" | "unknown";

const WIRE_ERROR_CODES: ReadonlySet<string> = new Set(MFA_WIRE_ERROR_CODES);

// ロックアウト (`locked`) と rate limit は同じ 429 で返る。status だけで丸めると「数十秒待てば通る」失敗を
// 15 分待たせるため、判別は body の error コードで行い、載っていない 429 を rate_limited に倒す。
const resolveMfaErrorCode = (status: number, wireError: string | undefined): MfaErrorCode => {
  if (wireError !== undefined && WIRE_ERROR_CODES.has(wireError)) return wireError as MfaErrorCode;
  if (status === 429) return "rate_limited";
  return "unknown";
};

class MfaApiError extends Error {
  constructor(public readonly code: MfaErrorCode) {
    super("多要素認証 (MFA) の操作に失敗しました。");
    this.name = "MfaApiError";
  }
}

// 非 MfaApiError (通信断・想定外 throw) は原因を識別できないため fail-closed に "unknown" へ倒す。
export const mfaErrorCodeOf = (error: unknown): MfaErrorCode =>
  error instanceof MfaApiError ? error.code : "unknown";

const asRecord = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;

function readWireError(body: unknown): string | undefined {
  const error = asRecord(body)?.error;
  return typeof error === "string" ? error : undefined;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  // credentials: cookie 送信に加えローテート後セッションの Set-Cookie 受領にも要る (外すと操作直後にログアウト)。
  const res = await fetch(url, { credentials: "include", ...init });
  // 空 body (activate / disable の 200) と非 JSON body (proxy が返す 5xx) を同じ経路で通す。
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new MfaApiError(resolveMfaErrorCode(res.status, readWireError(body)));
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

// 各 parser の satisfies が wire 型との結び付き: 正本に必須 field が増えるとここが型エラーになり、
// 検査と変換の追加を強制する。追加 field は無視する (server の additive 変更を壊さない)。
const readMfaStatus = (body: unknown): MfaStatus => {
  const wire = requireRecord(body);
  if (
    typeof wire.enabled !== "boolean" ||
    typeof wire.in_effect !== "boolean" ||
    typeof wire.recovery_codes_remaining !== "number"
  ) {
    throw new MfaApiError("unknown");
  }
  const checked = {
    enabled: wire.enabled,
    in_effect: wire.in_effect,
    recovery_codes_remaining: wire.recovery_codes_remaining,
  } satisfies MfaStatusResponse;
  return {
    enabled: checked.enabled,
    inEffect: checked.in_effect,
    recoveryCodesRemaining: checked.recovery_codes_remaining,
  };
};

// 空値も不正に倒す: 空 enrollment_id は照合 400 と表示 cache の袋小路、空 totp_uri は QR も
// secret も無い scan 画面、空 recovery_codes はリカバリー手段ゼロの有効化になる。
const readMfaEnrollment = (body: unknown): MfaEnrollment => {
  const wire = requireRecord(body);
  if (
    typeof wire.enrollment_id !== "string" ||
    wire.enrollment_id === "" ||
    typeof wire.totp_uri !== "string" ||
    wire.totp_uri === "" ||
    !isStringArray(wire.recovery_codes) ||
    wire.recovery_codes.length === 0
  ) {
    throw new MfaApiError("unknown");
  }
  const checked = {
    enrollment_id: wire.enrollment_id,
    totp_uri: wire.totp_uri,
    recovery_codes: wire.recovery_codes,
  } satisfies MfaEnrollResponse;
  return {
    enrollmentId: checked.enrollment_id,
    totpUri: checked.totp_uri,
    recoveryCodes: checked.recovery_codes,
  };
};

const readMfaChallengeState = (body: unknown): MfaChallengeState => {
  const wire = requireRecord(body);
  if (typeof wire.pending !== "boolean") throw new MfaApiError("unknown");
  return { pending: wire.pending } satisfies MfaChallengeStateResponse;
};

// 空文字も不正に倒す: passed のまま流すと flow の assign("") が現在 URL へ再遷移する。
const readMfaChallengePassed = (body: unknown): MfaChallengePassed => {
  const wire = requireRecord(body);
  if (typeof wire.redirect_url !== "string" || wire.redirect_url === "") {
    throw new MfaApiError("unknown");
  }
  const checked = { redirect_url: wire.redirect_url } satisfies MfaChallengeVerifyResponse;
  return { redirectUrl: checked.redirect_url };
};

export const getMfaStatus = (): Promise<MfaStatus> =>
  requestJson("/api/account/mfa").then(readMfaStatus);

export const enrollMfa = (): Promise<MfaEnrollment> =>
  postJson("/api/account/mfa/enroll").then(readMfaEnrollment);

// 成功時の body は消費しない (view に載せる data が無いため、形の検査もしない)。
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
