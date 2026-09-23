import { Data, Effect, Predicate } from "effect";

export class Unauthorized extends Data.TaggedError("Unauthorized") {
  readonly error = "unauthorized" as const;
  readonly status = 401 as const;
}

export class Forbidden extends Data.TaggedError("Forbidden") {
  readonly error = "forbidden" as const;
  readonly status = 403 as const;
}

export class NotFound extends Data.TaggedError("NotFound") {
  readonly error = "not_found" as const;
  readonly status = 404 as const;
}

export const orNotFound = Effect.filterOrFail(Predicate.isNotUndefined, () => new NotFound());

export class InvalidArgument extends Data.TaggedError("InvalidArgument")<{
  readonly details?: unknown;
}> {
  readonly error = "invalid_argument" as const;
  readonly status = 400 as const;
}

export class EmailMismatch extends Data.TaggedError("EmailMismatch") {
  readonly error = "email_mismatch" as const;
  readonly status = 403 as const;
}

export class AlreadyOwner extends Data.TaggedError("AlreadyOwner") {
  readonly error = "already_owner" as const;
  readonly status = 400 as const;
}

export class ExpiredOrUsed extends Data.TaggedError("ExpiredOrUsed") {
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
