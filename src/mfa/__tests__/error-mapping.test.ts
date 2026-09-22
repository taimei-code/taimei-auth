import { describe, expect, test } from "bun:test";
import {
  AlreadyEnabled,
  ChallengeExpired,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  type MfaError,
  MfaNotFound,
  NotEnabled,
} from "../error-mapping";

describe("MFA failure class", () => {
  const table: Array<[MfaError, MfaError["error"], MfaError["status"]]> = [
    [new InvalidCode(), "invalid_code", 400],
    [new Locked(), "locked", 429],
    [new ChallengeExpired(), "challenge_expired", 401],
    [new AlreadyEnabled(), "already_enabled", 409],
    [new EnrollmentChanged(), "enrollment_changed", 409],
    [new NotEnabled(), "not_enabled", 409],
    [new MfaNotFound(), "not_found", 404],
  ];

  for (const [failure, error, status] of table) {
    test(`QA-M-11 ${failure._tag} は ${error} / ${status} を自身で持つ`, () => {
      expect({ error: failure.error, status: failure.status }).toEqual({ error, status });
    });
  }
});
