import { Effect, Predicate, Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  {},
  { httpApiStatus: 404 },
) {}

export const orNotFound = Effect.filterOrFail(Predicate.isNotUndefined, () => new NotFound());

export class InvalidArgument extends Schema.TaggedError<InvalidArgument>()(
  "InvalidArgument",
  { details: Schema.optional(Schema.Unknown) },
  { httpApiStatus: 400 },
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  {},
  { httpApiStatus: 429 },
) {}
