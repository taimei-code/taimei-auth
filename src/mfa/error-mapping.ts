import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";
import { Sentry } from "../sentry";
import type { MatchesWireShape, MfaWireErrorCode } from "./wire-contracts";

// twoFactor プラグインのエラーコードを自前のエラー形へ写像する唯一の場所 (封じ込め: ADR-0013 §2)。
// プラグインのコード文字列は呼び出し側 (handler / SPA) に一切出さない。

// { error, status } は guard 層 (src/membership/guard/core.ts) と同形 —
// handler が `c.json({ error: r.error }, r.status)` の 1 行で HTTP に落とせる状態を保つ。
export type MfaError =
  | { readonly error: "invalid_code"; readonly status: 400 }
  | { readonly error: "locked"; readonly status: 429 }
  | { readonly error: "challenge_expired"; readonly status: 401 }
  | { readonly error: "already_enabled"; readonly status: 409 }
  | { readonly error: "enrollment_changed"; readonly status: 409 }
  | { readonly error: "not_enabled"; readonly status: 409 }
  | { readonly error: "not_found"; readonly status: 404 }
  | {
      readonly error: "temporarily_unavailable";
      readonly status: 503;
      readonly retryAfterSeconds: 10;
    };

type MfaErrorCode = MfaError["error"];

// wire 語彙から guard 層の 2 コードを除いた集合との双方向一致を固定する検出器 (増減で typecheck が落ちる)。
const _codesMatchWire: MatchesWireShape<
  Record<MfaErrorCode, true>,
  Record<Exclude<MfaWireErrorCode, "invalid_argument" | "unauthorized">, true>
> = true;

export type MfaFailure = { ok: false } & MfaError;

export const failure = (error: MfaError): MfaFailure => ({ ok: false, ...error });

const INVALID_CODE = { error: "invalid_code", status: 400 } as const satisfies MfaError;
export const LOCKED = { error: "locked", status: 429 } as const satisfies MfaError;

// cookie 無し / 改ざん / 期限切れ / 未知の失敗が全てここへ集まる — どの段階で落ちたかを漏らさない。
export const CHALLENGE_EXPIRED = {
  error: "challenge_expired",
  status: 401,
} as const satisfies MfaError;

// 以下は検証以外の失敗 — プラグイン由来ではなく use-case が自分の不変条件から返す。
export const ALREADY_ENABLED = {
  error: "already_enabled",
  status: 409,
} as const satisfies MfaError;
export const ENROLLMENT_CHANGED = {
  error: "enrollment_changed",
  status: 409,
} as const satisfies MfaError;
export const NOT_ENABLED = { error: "not_enabled", status: 409 } as const satisfies MfaError;
export const USER_NOT_FOUND = { error: "not_found", status: 404 } as const satisfies MfaError;
// registration guard の競合。Retry-After は 10 秒 — 1 秒にすると指示に従うクライアントが
// rate limit (10 req/60s) の上限に達し、guard 競合が 429 ロックへ化ける。
export const TEMPORARILY_UNAVAILABLE = {
  error: "temporarily_unavailable",
  status: 503,
  retryAfterSeconds: 10,
} as const satisfies MfaError;

// busy は guard 層だけが作る。写像表への 1 行追加で plugin 失敗が 503 + Retry-After に化けるのを型で塞ぐ。
export type PluginMappedError = Exclude<MfaError, { error: "temporarily_unavailable" }>;

type PluginErrorCode = keyof typeof TWO_FACTOR_ERROR_CODES;

// Record<PluginErrorCode, _> なので、better-auth 更新でコードが増減したら型エラーで落ちる。
// TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE を invalid_code へ寄せるが、プラグインは同時にチャレンジを破棄する
// (直後の再送は challenge_expired)。画面文言に「もう一度お試しください」を含めないこと。
const APP_ERROR_BY_PLUGIN_CODE: Record<PluginErrorCode, PluginMappedError> = {
  INVALID_CODE: INVALID_CODE,
  INVALID_BACKUP_CODE: INVALID_CODE,
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: INVALID_CODE,
  ACCOUNT_TEMPORARILY_LOCKED: LOCKED,
  INVALID_TWO_FACTOR_COOKIE: CHALLENGE_EXPIRED,
  OTP_NOT_ENABLED: CHALLENGE_EXPIRED,
  OTP_HAS_EXPIRED: CHALLENGE_EXPIRED,
  TOTP_NOT_ENABLED: CHALLENGE_EXPIRED,
  TWO_FACTOR_NOT_ENABLED: CHALLENGE_EXPIRED,
  BACKUP_CODES_NOT_ENABLED: CHALLENGE_EXPIRED,
};

// 自前 rate limit は Redis 障害時 fail-open のため、ロックアウトと破棄の急増はこれが唯一の検知信号。
const REPORTED_PLUGIN_CODES = new Set<PluginErrorCode>([
  "ACCOUNT_TEMPORARILY_LOCKED",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);

// body.code を構造的に読む — catch した値が本当に APIError である保証は型に無い (fail-closed 判定の入力)。
function readPluginErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { body } = error as { body?: unknown };
  if (typeof body !== "object" || body === null) return undefined;
  const { code } = body as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

// 外部入力キーでの lookup。prototype チェーン上のメンバーは undefined にならず fail-closed を素通りする。
function findAppError(pluginCode: string): PluginMappedError | undefined {
  return Object.hasOwn(APP_ERROR_BY_PLUGIN_CODE, pluginCode)
    ? APP_ERROR_BY_PLUGIN_CODE[pluginCode as PluginErrorCode]
    : undefined;
}

// 未知コードは challenge_expired へ fail-closed。invalid_code に倒すと、打ち直しても通らない失敗が
// 「打ち直せば通る」ように見え、袋小路に閉じ込める。
function reportUnmapped(pluginCode: string | undefined): PluginMappedError {
  Sentry.captureMessage("mfa: unmapped two factor error", {
    level: "error",
    tags: { component: "mfa-error-mapping", pluginCode },
  });
  return CHALLENGE_EXPIRED;
}

export function mapTwoFactorError(error: unknown): PluginMappedError {
  return mapPluginError(error) ?? reportUnmapped(undefined);
}

// undefined は「plugin 由来 (body.code 持ち) でない」の意味。plugin 由来なら未知コードも fail-closed で必ず落とす。
export function mapPluginError(error: unknown): PluginMappedError | undefined {
  const pluginCode = readPluginErrorCode(error);
  if (pluginCode === undefined) return undefined;

  const appError = findAppError(pluginCode);
  if (!appError) return reportUnmapped(pluginCode);

  if (REPORTED_PLUGIN_CODES.has(pluginCode as PluginErrorCode)) {
    Sentry.captureMessage("mfa: verification attempt budget exhausted", {
      level: "warning",
      tags: { component: "mfa-error-mapping", pluginCode },
    });
  }
  return appError;
}
