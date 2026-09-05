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

// プラグイン写像は消滅 (完全自前化: ADR-0016)。残るのは failure class 7 種のみ。
// wire 語彙との双方向一致は error-mapping.ts 内の MatchesWireShape 検出器 (typecheck) が固定する。

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
