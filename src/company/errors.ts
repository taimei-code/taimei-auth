import { Data } from "effect";

// company domain の failure (ADR-0017 Decision の failure 項)。wire code / status を自身で持つ。
export class AlreadyExists extends Data.TaggedError("AlreadyExists") {
  readonly error = "already_exists" as const;
  readonly status = 409 as const;
}

export class NotFoundOrAlreadyDeleted extends Data.TaggedError("NotFoundOrAlreadyDeleted") {
  readonly error = "not_found_or_already_deleted" as const;
  readonly status = 404 as const;
}

export type CompanyError = AlreadyExists | NotFoundOrAlreadyDeleted;
