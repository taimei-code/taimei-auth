import { Schema } from "effect";

export class AlreadyExists extends Schema.TaggedError<AlreadyExists>()(
  "AlreadyExists",
  {},
  { httpApiStatus: 409 },
) {
  readonly error = "already_exists" as const;
  readonly status = 409 as const;
}

export type CompanyError = AlreadyExists;
