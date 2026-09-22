import { Data } from "effect";
import type { MatchesClientFacingShape, MfaClientFacingErrorCode } from "./client-facing-contracts";

export class InvalidCode extends Data.TaggedError("InvalidCode") {
  readonly error = "invalid_code" as const;
  readonly status = 400 as const;
}

export class Locked extends Data.TaggedError("Locked") {
  readonly error = "locked" as const;
  readonly status = 429 as const;
}

// cookie 無し、改ざん、期限切れ、消費済みのすべてをここに集め、どの段階で失敗したかを外に漏らさない。
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

// MfaNotFound という名前は、同じ error code を持つ guard の NotFound と区別して読めるようにするため。
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

const _codesMatchWire: MatchesClientFacingShape<
  Record<MfaErrorCode, true>,
  Record<Exclude<MfaClientFacingErrorCode, "invalid_argument" | "unauthorized">, true>
> = true;
