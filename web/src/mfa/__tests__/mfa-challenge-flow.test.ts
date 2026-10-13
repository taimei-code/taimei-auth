import { describe, expect, test } from "bun:test";
import { mfaChallengeFlowStateOf, reduceMfaChallengeFlow } from "../mfa-challenge-flow";

describe("reduceMfaChallengeFlow", () => {
  test("AC-001 present の初期観測は error のない ready へ進む", () => {
    const state = mfaChallengeFlowStateOf({ kind: "present" });

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });

  test("AC-002 absent の初期観測は expired へ進む", () => {
    const state = mfaChallengeFlowStateOf({ kind: "absent" });

    expect(state).toEqual({ phase: "expired" });
  });

  test("AC-003 unavailable の初期観測は入力可能な ready へ縮退する", () => {
    const state = mfaChallengeFlowStateOf({ kind: "unavailable" });

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });

  test("AC-024 ready からの送信開始は直前 error を持たない verifying へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorMessage: "invalid_code" },
      { type: "verification_started" },
    );

    expect(state).toEqual({ phase: "verifying" });
  });

  test("AC-005 passed の検証結果は redirecting へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      {
        type: "verification_resolved",
        verification: { kind: "passed", redirectUrl: "/account" },
      },
    );

    expect(state).toEqual({ phase: "redirecting", redirectUrl: "/account" });
  });

  test("AC-006 terminal の検証結果は expired へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      { type: "verification_resolved", verification: { kind: "expired" } },
    );

    expect(state).toEqual({ phase: "expired" });
  });

  test("AC-007 retryable の検証結果は error 付き ready へ戻る", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      {
        type: "verification_resolved",
        verification: { kind: "rejected", errorMessage: "invalid_code" },
      },
    );

    expect(state).toEqual({ phase: "ready", errorMessage: "invalid_code" });
  });

  test("AC-015 kind 切替の error clear は ready の入力errorだけを消す", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorMessage: "invalid_code" },
      { type: "error_cleared" },
    );

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });
});
