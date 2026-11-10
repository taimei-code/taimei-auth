import { failure } from "../failure";

export class InvalidCode extends failure<InvalidCode>()("InvalidCode", {}, 400) {}

export class Locked extends failure<Locked>()("Locked", {}, 429) {}

export class ChallengeExpired extends failure<ChallengeExpired>()("ChallengeExpired", {}, 401) {}

export class AlreadyEnabled extends failure<AlreadyEnabled>()("AlreadyEnabled", {}, 409) {}

export class EnrollmentChanged extends failure<EnrollmentChanged>()("EnrollmentChanged", {}, 409) {}

export class NotEnabled extends failure<NotEnabled>()("NotEnabled", {}, 409) {}

export class MfaNotFound extends failure<MfaNotFound>()("MfaNotFound", {}, 404) {}
