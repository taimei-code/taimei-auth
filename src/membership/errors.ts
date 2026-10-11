import { Schema } from "effect";

export class LastOwner extends Schema.TaggedError<LastOwner>()(
  "LastOwner",
  {},
  { httpApiStatus: 409 },
) {
  readonly error = "last_owner" as const;
  readonly status = 409 as const;
}

export type MembershipError = LastOwner;
