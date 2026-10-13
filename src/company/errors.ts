import { Schema } from "effect";

export class AlreadyExists extends Schema.TaggedError<AlreadyExists>()(
  "AlreadyExists",
  {},
  { httpApiStatus: 409 },
) {}
