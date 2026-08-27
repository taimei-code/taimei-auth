import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";
import { Sentry } from "../sentry";
import type { MatchesWireShape, MfaWireErrorCode } from "./wire-contracts";

// twoFactor プラグインのエラーコードを自前のエラー形へ写像する唯一の場所。
// プラグインのコード文字列は呼び出し側 (handler / SPA) に一切出さない。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

// { error, status } の形は guard 層 (src/membership/guard/core.ts の Unauthorized 等) と同形。
// handler が `c.json({ error: r.error }, r.status)` の 1 行で HTTP に落とせる状態を保つ。
// error を判別子とする union — busy (temporarily_unavailable) だけが retryAfterSeconds を必ず運び、
// 消費者は field の有無 sniff でなく narrowing で分岐する。
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

// wire 語彙 (wire-contracts.ts) から guard 層の 2 コードを除いた集合との双方向一致を固定する検出器。
// どちらかの語彙が増減したら typecheck で落ちる (account-mfa.ts の _activateBodyMatchesWire と同形)。
const _codesMatchWire: MatchesWireShape<
  Record<MfaErrorCode, true>,
  Record<Exclude<MfaWireErrorCode, "invalid_argument" | "unauthorized">, true>
> = true;

export type MfaFailure = { ok: false } & MfaError;

export const failure = (error: MfaError): MfaFailure => ({ ok: false, ...error });

const INVALID_CODE = { error: "invalid_code", status: 400 } as const satisfies MfaError;
export const LOCKED = { error: "locked", status: 429 } as const satisfies MfaError;

// cookie 無し / 署名改ざん / 期限切れ / 未知の失敗が全てここへ集まる。呼び出し側からは
// 区別できないままにする (どの段階で落ちたかを未認証のブラウザに教えない)。
export const CHALLENGE_EXPIRED = {
  error: "challenge_expired",
  status: 401,
} as const satisfies MfaError;

// 検証以外の失敗。プラグイン由来ではなく use-case が自分の不変条件から返す。
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
// registration guard の競合。Retry-After の 10 秒は rate limit (10 req/60s のスライディング窓) と
// 両立する値 — 1 秒にすると指示に従うクライアントが 10 秒で上限に達し、guard 競合が 429 ロックへ化ける。
export const TEMPORARILY_UNAVAILABLE = {
  error: "temporarily_unavailable",
  status: 503,
  retryAfterSeconds: 10,
} as const satisfies MfaError;

// busy (temporarily_unavailable) は guard 層だけが作る。plugin 写像がこの code を返せる形だと、
// 写像表への 1 行追加で plugin 失敗が 503 + Retry-After に化けるため、型から除いて塞ぐ。
export type PluginMappedError = Exclude<MfaError, { error: "temporarily_unavailable" }>;

type PluginErrorCode = keyof typeof TWO_FACTOR_ERROR_CODES;

// Record<PluginErrorCode, _> にすることで、better-auth 更新でコードが増減したら型エラーで落ちる
// (テストを待たずに写像漏れが顕在化する)。
//
// TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE を invalid_code に寄せるのは、自前エラー形を 3 種に保つ決定。
// ただしプラグインはこのエラーを投げる時点でチャレンジ自体を破棄するため、直後の再送は
// challenge_expired に落ちる。画面文言に「もう一度お試しください」を含めないこと。
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

// 自前の rate limit は Redis 障害時 fail-open のため、ロックアウトとチャレンジ破棄の急増は
// これが唯一の検知信号になる。
const REPORTED_PLUGIN_CODES = new Set<PluginErrorCode>([
  "ACCOUNT_TEMPORARILY_LOCKED",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);

// APIError の body.code を構造的に読む。better-auth の APIError 型に依存させないのは、
// gateway が catch する値が本当に APIError である保証が型に無いため (fail-closed 判定の入力)。
function readPluginErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { body } = error as { body?: unknown };
  if (typeof body !== "object" || body === null) return undefined;
  const { code } = body as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

// plugin 由来の外部入力キーでの lookup。prototype チェーン上のメンバー ("toString" 等) は
// undefined にならず fail-closed を素通りするため、hasOwn を先に挟む。
function findAppError(pluginCode: string): PluginMappedError | undefined {
  return Object.hasOwn(APP_ERROR_BY_PLUGIN_CODE, pluginCode)
    ? APP_ERROR_BY_PLUGIN_CODE[pluginCode as PluginErrorCode]
    : undefined;
}

// 未知コードは challenge_expired へ fail-closed する。invalid_code に倒すと、実際には
// 打ち直しても通らない失敗が「コードを打ち直せば通る」ように見え、袋小路に閉じ込める。
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
