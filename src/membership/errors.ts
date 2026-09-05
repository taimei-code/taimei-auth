import { Data } from "effect";

// membership domain の failure (ADR-0017 Decision の failure 項)。wire code / status を自身で持つ (adapter は直列化のみ)。
// OWNER ≥ 1 不変条件 (ADR-0010) を割る操作。Repository の OwnerInvariantViolation を wiring が写像する。
export class LastOwner extends Data.TaggedError("LastOwner") {
  readonly error = "last_owner" as const;
  readonly status = 409 as const;
}

export type MembershipError = LastOwner;
