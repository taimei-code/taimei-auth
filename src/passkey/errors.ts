import { failure } from "../failure";

export class PasskeyRejected extends failure<PasskeyRejected>()("PasskeyRejected", {}, 400) {}

export class TotpRequired extends failure<TotpRequired>()("TotpRequired", {}, 403) {}

export class PasskeyAlreadyRegistered extends failure<PasskeyAlreadyRegistered>()(
  "PasskeyAlreadyRegistered",
  {},
  409,
) {}
