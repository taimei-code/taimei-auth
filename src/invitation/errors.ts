import { Data } from "effect";

// invitation domain の failure (ADR-0017 Decision の failure 項)。wire code / status を自身で持つ。
// expired_or_used (410) は guard (招待受諾の isAcceptable) が生成するため src/membership/guard/errors.ts 側。
export class NotFoundOrNotPending extends Data.TaggedError("NotFoundOrNotPending") {
  readonly error = "not_found_or_not_pending" as const;
  readonly status = 404 as const;
}

export class RateLimited extends Data.TaggedError("RateLimited") {
  readonly error = "rate_limited" as const;
  readonly status = 429 as const;
}

// accept 拒否の内訳。audit payload の `reason` と 1:1 で、監視 query の語彙 (運用契約: ADR-0012)。
// 拒否そのものは guard の ExpiredOrUsed (expired_or_used / 410) で返すため、この語彙は audit 専用。
export type RejectReason =
  | "double_accept"
  | "unknown_invited_role"
  | "inviter_not_owner_or_missing";

export type InvitationError = NotFoundOrNotPending | RateLimited;
