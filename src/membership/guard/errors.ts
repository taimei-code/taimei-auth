import { Data } from "effect";

// membership guard の failure class (ADR-0012 の catalog を class に移したもの、ADR-0017 Decision の failure 項)。
// 各 class が wire code `error` と HTTP `status` を自身で持つ (catalog 分散)。adapter (runRoute) は
// `{ error, details? }` に直列化するだけで、文字列 × status の対応表はここが正本。
// details は InvalidArgument だけが持ち、undefined のときは key 自体を持たせない (byte-invariant)。
// class は Data.TaggedError (decode 経路が無いため Schema は持ち込まない、src/errors.ts 参照)。

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
