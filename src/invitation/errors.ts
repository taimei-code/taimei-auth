import { Schema } from "effect";

export class NotFoundOrNotPending extends Schema.TaggedError<NotFoundOrNotPending>()(
  "NotFoundOrNotPending",
  {},
  { httpApiStatus: 404 },
) {}

export class EmailMismatch extends Schema.TaggedError<EmailMismatch>()(
  "EmailMismatch",
  {},
  { httpApiStatus: 403 },
) {}

export class ExpiredOrUsed extends Schema.TaggedError<ExpiredOrUsed>()(
  "ExpiredOrUsed",
  {},
  { httpApiStatus: 410 },
) {}
