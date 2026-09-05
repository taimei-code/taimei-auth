import { Data } from "effect";
import type { MatchesWireShape, MfaWireErrorCode } from "./wire-contracts";

// MFA use-case の失敗 class の正本。自前検証 (src/mfa/totp/) が直接この class を E channel に載せる —
// プラグイン写像は存在しない (完全自前化: ADR-0016)。
//
// 各 class が wire code `error` と HTTP `status` を自身で持つ形は guard 層
// (src/membership/guard/errors.ts) と同形 — adapter (src/handlers/run-route.ts) が guard の failure と
// 同じ 1 経路で wire に落とせる状態を保つ (ADR-0017 Decision の failure 項)。

export class InvalidCode extends Data.TaggedError("InvalidCode") {
  readonly error = "invalid_code" as const;
  readonly status = 400 as const;
}

export class Locked extends Data.TaggedError("Locked") {
  readonly error = "locked" as const;
  readonly status = 429 as const;
}

// cookie 無し / 改ざん / 期限切れ / 消費済み / 未知の失敗が全てここへ集まる — どの段階で落ちたかを漏らさない。
export class ChallengeExpired extends Data.TaggedError("ChallengeExpired") {
  readonly error = "challenge_expired" as const;
  readonly status = 401 as const;
}

export class AlreadyEnabled extends Data.TaggedError("AlreadyEnabled") {
  readonly error = "already_enabled" as const;
  readonly status = 409 as const;
}

export class EnrollmentChanged extends Data.TaggedError("EnrollmentChanged") {
  readonly error = "enrollment_changed" as const;
  readonly status = 409 as const;
}

export class NotEnabled extends Data.TaggedError("NotEnabled") {
  readonly error = "not_enabled" as const;
  readonly status = 409 as const;
}

// 見つからないのは登録 (mfa_totp 行) — user 自体は requireActor が解決済み。class 名を MfaNotFound に
// するのは、同じ wire code を持つ guard の NotFound (src/membership/guard/errors.ts) と読み分けるため。
export class MfaNotFound extends Data.TaggedError("MfaNotFound") {
  readonly error = "not_found" as const;
  readonly status = 404 as const;
}

export type MfaError =
  | InvalidCode
  | Locked
  | ChallengeExpired
  | AlreadyEnabled
  | EnrollmentChanged
  | NotEnabled
  | MfaNotFound;

type MfaErrorCode = MfaError["error"];

// wire 語彙から guard 層の 2 コードを除いた集合との双方向一致を固定する検出器 (増減で typecheck が落ちる)。
const _codesMatchWire: MatchesWireShape<
  Record<MfaErrorCode, true>,
  Record<Exclude<MfaWireErrorCode, "invalid_argument" | "unauthorized">, true>
> = true;
