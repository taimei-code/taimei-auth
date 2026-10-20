import { Schema } from "effect";

export class LastOwner extends Schema.TaggedError<LastOwner>()(
  "LastOwner",
  {},
  { httpApiStatus: 409 },
) {}

export class AlreadyOwner extends Schema.TaggedError<AlreadyOwner>()(
  "AlreadyOwner",
  {},
  { httpApiStatus: 400 },
) {}
