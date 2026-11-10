import { failure } from "../failure";

export class NotFoundOrNotPending extends failure<NotFoundOrNotPending>()(
  "NotFoundOrNotPending",
  {},
  404,
) {}

export class EmailMismatch extends failure<EmailMismatch>()("EmailMismatch", {}, 403) {}

export class ExpiredOrUsed extends failure<ExpiredOrUsed>()("ExpiredOrUsed", {}, 410) {}
