import { Schema } from "effect";

export class LastOwner extends Schema.TaggedError<LastOwner>()(
  "LastOwner",
  {},
  { httpApiStatus: 409 },
) {}
