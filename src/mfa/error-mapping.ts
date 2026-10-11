import { Schema } from "effect";
import type { MatchesClientFacingShape, MfaClientFacingErrorCode } from "./client-facing-contracts";

export class InvalidCode extends Schema.TaggedError<InvalidCode>()(
  "InvalidCode",
  {},
  { httpApiStatus: 400 },
) {
  readonly error = "invalid_code" as const;
  readonly status = 400 as const;
}

export class Locked extends Schema.TaggedError<Locked>()("Locked", {}, { httpApiStatus: 429 }) {
  readonly error = "locked" as const;
  readonly status = 429 as const;
}

// cookie 無し・改ざん・期限切れ・消費済みを 1 つに集め、どの段階で失敗したかを漏らさない。
export class ChallengeExpired extends Schema.TaggedError<ChallengeExpired>()(
  "ChallengeExpired",
  {},
  { httpApiStatus: 401 },
) {
  readonly error = "challenge_expired" as const;
  readonly status = 401 as const;
}

export class AlreadyEnabled extends Schema.TaggedError<AlreadyEnabled>()(
  "AlreadyEnabled",
  {},
  { httpApiStatus: 409 },
) {
  readonly error = "already_enabled" as const;
  readonly status = 409 as const;
}

export class EnrollmentChanged extends Schema.TaggedError<EnrollmentChanged>()(
  "EnrollmentChanged",
  {},
  { httpApiStatus: 409 },
) {
  readonly error = "enrollment_changed" as const;
  readonly status = 409 as const;
}

export class NotEnabled extends Schema.TaggedError<NotEnabled>()(
  "NotEnabled",
  {},
  { httpApiStatus: 409 },
) {
  readonly error = "not_enabled" as const;
  readonly status = 409 as const;
}

export class MfaNotFound extends Schema.TaggedError<MfaNotFound>()(
  "MfaNotFound",
  {},
  { httpApiStatus: 404 },
) {
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
