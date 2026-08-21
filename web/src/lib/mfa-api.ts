// SPA → auth-service の多要素認証 (MFA) API client。
//
// account-api.ts と分けているのは、エラーを status で解けないため: describeAccountApiError の
// status → 文言 では「ロックアウト (15 分待ち)」と「操作が集中 (数十秒待ち)」を書き分けられない。
// body の error コードを MfaApiError.code に載せ、code → 文言 (use-mfa-code-entry の
// describeMfaChallengeError) で解く。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

import { MFA_WIRE_ERROR_CODES, type MfaWireErrorCode } from "@core/mfa/wire-contracts";
import type { MfaCodeKind } from "@core/mfa/wire-contracts";

export type { MfaCodeKind } from "@core/mfa/wire-contracts";

export type MfaStatus = {
  enabled: boolean;
  // two_factor 認証がまだ効いているか。enabled=false でも「中断した無効化」は true になり、
  // その状態の唯一の出口は無効化操作 (enroll は 409 で拒まれる) なので disable を出す判定に使う。
  in_effect: boolean;
  recovery_codes_remaining: number;
};

// recovery_codes は登録途中のenroll再実行で同じ値を返す。有効化後は残数しか取得できない。
// 受け取った画面より先へ持ち出さないこと。
export type MfaEnrollment = {
  enrollment_id: string;
  totp_uri: string;
  recovery_codes: string[];
};

export type MfaChallengeState = { pending: boolean };

export type MfaChallengePassed = { redirect_url: string };

export type MfaErrorCode = MfaWireErrorCode | "rate_limited" | "unknown";

const WIRE_ERROR_CODES: ReadonlySet<string> = new Set(MFA_WIRE_ERROR_CODES);

// ロックアウト (`locked`) と rate limit は同じ 429 で返るため、status だけで丸めると
// 「数十秒待てば通る」失敗をユーザーに 15 分待たせる。判別は body の error コードで行い、
// 載っていない 429 を rate_limited、それ以外の未知の失敗を unknown に倒す。
export function resolveMfaErrorCode(status: number, wireError: string | undefined): MfaErrorCode {
  if (wireError !== undefined && WIRE_ERROR_CODES.has(wireError)) return wireError as MfaErrorCode;
  if (status === 429) return "rate_limited";
  return "unknown";
}

// message を汎用の日本語にしているのは、useAsyncLoad が catch した Error の message を
// そのまま画面へ出すため。原因の識別は code / status を読むこと。
export class MfaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: MfaErrorCode,
  ) {
    super("多要素認証 (MFA) の操作に失敗しました。");
    this.name = "MfaApiError";
  }
}

function readWireError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { error } = body as { error?: unknown };
  return typeof error === "string" ? error : undefined;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  // credentials: セッション cookie の送信に加え、activate / disable / verify が返す
  // ローテート後セッションの Set-Cookie 受領にも要る (外すと操作直後にログアウトする)。
  const res = await fetch(url, { credentials: "include", ...init });
  // 空 body (activate / disable の 200) と非 JSON body (proxy が返す 5xx) を同じ経路で通す。
  const body = await res.json().catch(() => undefined);
  if (!res.ok)
    throw new MfaApiError(res.status, resolveMfaErrorCode(res.status, readWireError(body)));
  return body as T;
}

const postJson = <T>(url: string, body?: unknown): Promise<T> =>
  requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const getMfaStatus = (): Promise<MfaStatus> => requestJson("/api/account/mfa");

export const enrollMfa = (): Promise<MfaEnrollment> => postJson("/api/account/mfa/enroll");

export const activateMfa = (input: { code: string; enrollmentId: string }): Promise<void> =>
  postJson("/api/account/mfa/activate", {
    code: input.code,
    enrollment_id: input.enrollmentId,
  });

export const disableMfa = (input: { code: string; kind: MfaCodeKind }): Promise<void> =>
  postJson("/api/account/mfa/disable", input);

export const getMfaChallenge = (signal?: AbortSignal): Promise<MfaChallengeState> =>
  requestJson("/api/mfa/challenge", { signal });

export const verifyMfaChallenge = (input: {
  code: string;
  kind: MfaCodeKind;
}): Promise<MfaChallengePassed> => postJson("/api/mfa/challenge/verify", input);
