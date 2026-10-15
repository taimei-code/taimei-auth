import { describe, expect, test } from "bun:test";
import { mfaChallengeFlowStateOf, reduceMfaChallengeFlow } from "../mfa-challenge-flow";

describe("reduceMfaChallengeFlow", () => {
  test("最初の観測が present なら、error の無い ready へ進む", () => {
    const state = mfaChallengeFlowStateOf({ kind: "present" });

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });

  test("最初の観測が absent なら expired へ進む", () => {
    const state = mfaChallengeFlowStateOf({ kind: "absent" });

    expect(state).toEqual({ phase: "expired" });
  });

  test("最初の観測が unavailable なら、入力できる ready へ進む", () => {
    const state = mfaChallengeFlowStateOf({ kind: "unavailable" });

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });

  test("ready から送信を始めると、直前の error を持たない verifying へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorMessage: "invalid_code" },
      { type: "verification_started" },
    );

    expect(state).toEqual({ phase: "verifying" });
  });

  test("検証の結果が passed なら redirecting へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      {
        type: "verification_resolved",
        verification: { kind: "passed", redirectUrl: "/account" },
      },
    );

    expect(state).toEqual({ phase: "redirecting", redirectUrl: "/account" });
  });

  test("検証の結果が terminal なら expired へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      { type: "verification_resolved", verification: { kind: "expired" } },
    );

    expect(state).toEqual({ phase: "expired" });
  });

  test("検証の結果が retryable なら error 付きの ready へ戻る", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "verifying" },
      {
        type: "verification_resolved",
        verification: { kind: "rejected", errorMessage: "invalid_code" },
      },
    );

    expect(state).toEqual({ phase: "ready", errorMessage: "invalid_code" });
  });

  test("コードの種類を切り替えると、ready の入力の error だけを消す", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorMessage: "invalid_code" },
      { type: "error_cleared" },
    );

    expect(state).toEqual({ phase: "ready", errorMessage: null });
  });
});
