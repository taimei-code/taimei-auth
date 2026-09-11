import { Data } from "effect";

export class NotFoundOrNotPending extends Data.TaggedError("NotFoundOrNotPending") {
  readonly error = "not_found_or_not_pending" as const;
  readonly status = 404 as const;
}

export class RateLimited extends Data.TaggedError("RateLimited") {
  readonly error = "rate_limited" as const;
  readonly status = 429 as const;
}

export type RejectReason = "double_accept" | "inviter_not_owner_or_missing";

export type InvitationError = NotFoundOrNotPending | RateLimited;
