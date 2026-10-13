import { Schema } from "effect";

export class NotFoundOrNotPending extends Schema.TaggedError<NotFoundOrNotPending>()(
  "NotFoundOrNotPending",
  {},
  { httpApiStatus: 404 },
) {}
