import { Schema } from "effect";

export class NotFoundOrNotPending extends Schema.TaggedError<NotFoundOrNotPending>()(
  "NotFoundOrNotPending",
  {},
  { httpApiStatus: 404 },
) {
  readonly error = "not_found_or_not_pending" as const;
  readonly status = 404 as const;
}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  {},
  { httpApiStatus: 429 },
) {
  readonly error = "rate_limited" as const;
  readonly status = 429 as const;
}

export type InvitationError = NotFoundOrNotPending | RateLimited;
