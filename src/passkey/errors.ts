import { failure } from "../failure";

export class PasskeyRejected extends failure<PasskeyRejected>()("PasskeyRejected", {}, 400) {}

export class PasskeyAlreadyRegistered extends failure<PasskeyAlreadyRegistered>()(
  "PasskeyAlreadyRegistered",
  {},
  409,
) {}

export class PasskeyRegistrationUnavailable extends failure<PasskeyRegistrationUnavailable>()(
  "PasskeyRegistrationUnavailable",
  {},
  403,
) {}

export class PasskeyLimitReached extends failure<PasskeyLimitReached>()(
  "PasskeyLimitReached",
  {},
  409,
) {}
