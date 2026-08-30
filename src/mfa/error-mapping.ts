import type { MatchesWireShape, MfaWireErrorCode } from "./wire-contracts";

// MFA use-case が返す失敗の形の正本。自前検証 (src/mfa/totp/) が直接この定数群を返す —
// プラグイン写像は存在しない (完全自前化: ADR-0016)。

// { error, status } は guard 層 (src/membership/guard/core.ts) と同形 —
// handler が `c.json({ error: r.error }, r.status)` の 1 行で HTTP に落とせる状態を保つ。
export type MfaError =
  | { readonly error: "invalid_code"; readonly status: 400 }
  | { readonly error: "locked"; readonly status: 429 }
  | { readonly error: "challenge_expired"; readonly status: 401 }
  | { readonly error: "already_enabled"; readonly status: 409 }
  | { readonly error: "enrollment_changed"; readonly status: 409 }
  | { readonly error: "not_enabled"; readonly status: 409 }
  | { readonly error: "not_found"; readonly status: 404 };

type MfaErrorCode = MfaError["error"];

// wire 語彙から guard 層の 2 コードを除いた集合との双方向一致を固定する検出器 (増減で typecheck が落ちる)。
const _codesMatchWire: MatchesWireShape<
  Record<MfaErrorCode, true>,
  Record<Exclude<MfaWireErrorCode, "invalid_argument" | "unauthorized">, true>
> = true;

export type MfaFailure = { ok: false } & MfaError;

export const failure = (error: MfaError): MfaFailure => ({ ok: false, ...error });

export const INVALID_CODE = { error: "invalid_code", status: 400 } as const satisfies MfaError;
export const LOCKED = { error: "locked", status: 429 } as const satisfies MfaError;

// cookie 無し / 改ざん / 期限切れ / 消費済み / 未知の失敗が全てここへ集まる — どの段階で落ちたかを漏らさない。
export const CHALLENGE_EXPIRED = {
  error: "challenge_expired",
  status: 401,
} as const satisfies MfaError;

export const ALREADY_ENABLED = {
  error: "already_enabled",
  status: 409,
} as const satisfies MfaError;
export const ENROLLMENT_CHANGED = {
  error: "enrollment_changed",
  status: 409,
} as const satisfies MfaError;
export const NOT_ENABLED = { error: "not_enabled", status: 409 } as const satisfies MfaError;
// 見つからないのは登録 (mfa_totp 行) — user 自体は requireActor が解決済み。
export const NOT_FOUND = { error: "not_found", status: 404 } as const satisfies MfaError;
