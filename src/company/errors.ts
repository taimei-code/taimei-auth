import { Data } from "effect";

export class AlreadyExists extends Data.TaggedError("AlreadyExists") {
  readonly error = "already_exists" as const;
  readonly status = 409 as const;
}

export type CompanyError = AlreadyExists;
