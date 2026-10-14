import { Schema } from "effect";

export class InvalidCode extends Schema.TaggedError<InvalidCode>()(
  "InvalidCode",
  {},
  { httpApiStatus: 400 },
) {}

export class Locked extends Schema.TaggedError<Locked>()("Locked", {}, { httpApiStatus: 429 }) {}

export class ChallengeExpired extends Schema.TaggedError<ChallengeExpired>()(
  "ChallengeExpired",
  {},
  { httpApiStatus: 401 },
) {}

export class AlreadyEnabled extends Schema.TaggedError<AlreadyEnabled>()(
  "AlreadyEnabled",
  {},
  { httpApiStatus: 409 },
) {}

export class EnrollmentChanged extends Schema.TaggedError<EnrollmentChanged>()(
  "EnrollmentChanged",
  {},
  { httpApiStatus: 409 },
) {}

export class NotEnabled extends Schema.TaggedError<NotEnabled>()(
  "NotEnabled",
  {},
  { httpApiStatus: 409 },
) {}

export class MfaNotFound extends Schema.TaggedError<MfaNotFound>()(
  "MfaNotFound",
  {},
  { httpApiStatus: 404 },
) {}
