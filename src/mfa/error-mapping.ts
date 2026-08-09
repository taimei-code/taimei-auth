import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";
import { Sentry } from "../sentry";

// twoFactor プラグインのエラーコードを自前のエラー形へ写像する唯一の場所。
// プラグインのコード文字列は呼び出し側 (handler / SPA) に一切出さない。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

export type MfaErrorCode =
  | "invalid_code"
  | "challenge_expired"
  | "locked"
  | "already_enabled"
  | "not_found";

// { error, status } の形は guard 層 (src/membership/guard/core.ts の Unauthorized 等) と同形。
// handler が `c.json({ error: r.error }, r.status)` の 1 行で HTTP に落とせる状態を保つ。
export type MfaError = {
  readonly error: MfaErrorCode;
  readonly status: 400 | 401 | 404 | 409 | 429;
};

export type MfaFailure = { ok: false } & MfaError;

export const failure = (error: MfaError): MfaFailure => ({ ok: false, ...error });

const INVALID_CODE: MfaError = { error: "invalid_code", status: 400 };
const LOCKED: MfaError = { error: "locked", status: 429 };

// cookie 無し / 署名改ざん / 期限切れ / 未知の失敗が全てここへ集まる。呼び出し側からは
// 区別できないままにする (どの段階で落ちたかを未認証のブラウザに教えない)。
export const CHALLENGE_EXPIRED: MfaError = { error: "challenge_expired", status: 401 };

// 検証以外の失敗。プラグイン由来ではなく use-case が自分の不変条件から返す。
export const ALREADY_ENABLED: MfaError = { error: "already_enabled", status: 409 };
export const USER_NOT_FOUND: MfaError = { error: "not_found", status: 404 };

type PluginErrorCode = keyof typeof TWO_FACTOR_ERROR_CODES;

// Record<PluginErrorCode, _> にすることで、better-auth 更新でコードが増減したら型エラーで落ちる
// (テストを待たずに写像漏れが顕在化する)。
//
// TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE を invalid_code に寄せるのは、自前エラー形を 3 種に保つ決定。
// ただしプラグインはこのエラーを投げる時点でチャレンジ自体を破棄するため、直後の再送は
// challenge_expired に落ちる。画面文言に「もう一度お試しください」を含めないこと。
const APP_ERROR_BY_PLUGIN_CODE: Record<PluginErrorCode, MfaError> = {
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
function findAppError(pluginCode: string): MfaError | undefined {
  return Object.hasOwn(APP_ERROR_BY_PLUGIN_CODE, pluginCode)
    ? APP_ERROR_BY_PLUGIN_CODE[pluginCode as PluginErrorCode]
    : undefined;
}

export function mapTwoFactorError(error: unknown): MfaError {
  const pluginCode = readPluginErrorCode(error);
  const appError = pluginCode === undefined ? undefined : findAppError(pluginCode);

  // 未知コードは challenge_expired へ fail-closed する。invalid_code に倒すと、実際には
  // 打ち直しても通らない失敗が「コードを打ち直せば通る」ように見え、袋小路に閉じ込める。
  if (!appError) {
    Sentry.captureMessage("mfa: unmapped two factor error", {
      level: "error",
      tags: { component: "mfa-error-mapping", pluginCode },
    });
    return CHALLENGE_EXPIRED;
  }

  if (REPORTED_PLUGIN_CODES.has(pluginCode as PluginErrorCode)) {
    Sentry.captureMessage("mfa: verification attempt budget exhausted", {
      level: "warning",
      tags: { component: "mfa-error-mapping", pluginCode },
    });
  }
  return appError;
}
