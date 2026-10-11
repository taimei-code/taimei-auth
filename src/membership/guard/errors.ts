import { Effect, Predicate, Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {
  readonly error = "unauthorized" as const;
  readonly status = 401 as const;
}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {
  readonly error = "forbidden" as const;
  readonly status = 403 as const;
}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  {},
  { httpApiStatus: 404 },
) {
  readonly error = "not_found" as const;
  readonly status = 404 as const;
}

export const orNotFound = Effect.filterOrFail(Predicate.isNotUndefined, () => new NotFound());

export class InvalidArgument extends Schema.TaggedError<InvalidArgument>()(
  "InvalidArgument",
  { details: Schema.optional(Schema.Unknown) },
  { httpApiStatus: 400 },
) {
  readonly error = "invalid_argument" as const;
  readonly status = 400 as const;
}

export class EmailMismatch extends Schema.TaggedError<EmailMismatch>()(
  "EmailMismatch",
  {},
  { httpApiStatus: 403 },
) {
  readonly error = "email_mismatch" as const;
  readonly status = 403 as const;
}

export class AlreadyOwner extends Schema.TaggedError<AlreadyOwner>()(
  "AlreadyOwner",
  {},
  { httpApiStatus: 400 },
) {
  readonly error = "already_owner" as const;
  readonly status = 400 as const;
}

export class ExpiredOrUsed extends Schema.TaggedError<ExpiredOrUsed>()(
  "ExpiredOrUsed",
  {},
  { httpApiStatus: 410 },
) {
  readonly error = "expired_or_used" as const;
  readonly status = 410 as const;
}

export type GuardError =
  | Unauthorized
  | Forbidden
  | NotFound
  | InvalidArgument
  | EmailMismatch
  | AlreadyOwner
  | ExpiredOrUsed;
