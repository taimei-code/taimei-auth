import { Effect, Predicate, Schema } from "effect";
import { failure } from "./failure";

export class Unauthorized extends failure<Unauthorized>()("Unauthorized", {}, 401) {}

export class Forbidden extends failure<Forbidden>()("Forbidden", {}, 403) {}

export class NotFound extends failure<NotFound>()("NotFound", {}, 404) {}

export const orNotFound = Effect.filterOrFail(Predicate.isNotUndefined, () => new NotFound());

export class InvalidArgument extends failure<InvalidArgument>()(
  "InvalidArgument",
  { details: Schema.optional(Schema.Unknown) },
  400,
) {}

export class RateLimited extends failure<RateLimited>()("RateLimited", {}, 429) {}

export class ServiceKeyRejected extends failure<ServiceKeyRejected>()(
  "ServiceKeyRejected",
  {},
  401,
) {}

export class ServiceKeyMisconfigured extends failure<ServiceKeyMisconfigured>()(
  "ServiceKeyMisconfigured",
  {},
  503,
) {}
