import { describe, expect, test } from "bun:test";
import {
  initialMfaChallengeFlowState,
  reduceMfaChallengeFlow,
  resolveMfaChallengeVerification,
  type MfaChallengePort,
} from "../mfa-challenge-flow";

describe("reduceMfaChallengeFlow", () => {
  test("AC-001 present の初期観測は error のない ready へ進む", () => {
    const state = reduceMfaChallengeFlow(initialMfaChallengeFlowState, {
      type: "observation_resolved",
      observation: { kind: "present" },
    });

    expect(state).toEqual({ phase: "ready", errorCode: null });
  });

  test("AC-002 absent の初期観測は expired へ進む", () => {
    const state = reduceMfaChallengeFlow(initialMfaChallengeFlowState, {
      type: "observation_resolved",
      observation: { kind: "absent" },
    });

    expect(state).toEqual({ phase: "expired" });
  });

  test("AC-003 unavailable の初期観測は入力可能な ready へ縮退する", () => {
    const state = reduceMfaChallengeFlow(initialMfaChallengeFlowState, {
      type: "observation_resolved",
      observation: { kind: "unavailable" },
    });

    expect(state).toEqual({ phase: "ready", errorCode: null });
  });

  test("AC-024 ready からの送信開始は直前 error を持たない verifying へ進む", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorCode: "invalid_code" },
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
        verification: { kind: "rejected", errorCode: "invalid_code" },
      },
    );

    expect(state).toEqual({ phase: "ready", errorCode: "invalid_code" });
  });

  test("AC-015 kind 切替の error clear は ready の入力errorだけを消す", () => {
    const state = reduceMfaChallengeFlow(
      { phase: "ready", errorCode: "invalid_code" },
      { type: "error_cleared" },
    );

    expect(state).toEqual({ phase: "ready", errorCode: null });
  });
});

describe("resolveMfaChallengeVerification", () => {
  test("AC-005 passed は再照会せず redirect URL を返す", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "present" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "passed", redirectUrl: "/account" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "123456" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "passed", redirectUrl: "/account" });
    expect(calls).toEqual({ observe: 0, verify: 1 });
  });

  test("AC-010 locked は再照会せず rejected のまま返す", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "present" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode: "locked" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "123456" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "rejected", errorCode: "locked" });
    expect(calls).toEqual({ observe: 0, verify: 1 });
  });

  test("AC-006 challenge_expired は再照会せず terminal outcome にする", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "present" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode: "challenge_expired" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "123456" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "expired" });
    expect(calls).toEqual({ observe: 0, verify: 1 });
  });

  test("AC-007 invalid_code は一度再照会し present なら rejected のまま返す", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "present" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode: "invalid_code" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "000000" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "rejected", errorCode: "invalid_code" });
    expect(calls).toEqual({ observe: 1, verify: 1 });
  });

  test("AC-008 invalid_code の再照会が absent なら terminal outcome にする", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "absent" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode: "invalid_code" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "000000" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "expired" });
    expect(calls).toEqual({ observe: 1, verify: 1 });
  });

  test("AC-009 invalid_code の再照会が unavailable なら元の error を保つ", async () => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "unavailable" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode: "invalid_code" };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "000000" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "rejected", errorCode: "invalid_code" });
    expect(calls).toEqual({ observe: 1, verify: 1 });
  });

  test.each([
    "rate_limited",
    "already_enabled",
    "enrollment_changed",
    "temporarily_unavailable",
    "not_enabled",
    "invalid_argument",
    "unauthorized",
    "not_found",
    "unknown",
  ])("AC-011/012/026-032 %s は再照会せず rejected のまま返す", async (errorCode) => {
    const calls = { observe: 0, verify: 0 };
    const port: MfaChallengePort<{ code: string }, string> = {
      observe: async () => {
        calls.observe++;
        return { kind: "present" };
      },
      verify: async () => {
        calls.verify++;
        return { kind: "rejected", errorCode };
      },
    };

    const outcome = await resolveMfaChallengeVerification(
      port,
      { code: "123456" },
      new AbortController().signal,
    );

    expect(outcome).toEqual({ kind: "rejected", errorCode });
    expect(calls).toEqual({ observe: 0, verify: 1 });
  });
});
