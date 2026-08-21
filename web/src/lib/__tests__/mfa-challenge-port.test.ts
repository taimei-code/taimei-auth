import { describe, expect, test } from "bun:test";
import { createMfaChallengePort } from "../mfa-challenge-port";
import { MfaApiError } from "../mfa-api";

describe("createMfaChallengePort", () => {
  test("AC-001/018 pending true を present に変換し同じ AbortSignal を渡す", async () => {
    let receivedSignal: AbortSignal | undefined;
    const port = createMfaChallengePort({
      getChallenge: async (signal) => {
        receivedSignal = signal;
        return { pending: true };
      },
      verifyChallenge: async () => ({ redirect_url: "/account" }),
    });
    const signal = new AbortController().signal;

    const result = await port.observe(signal);

    expect(result).toEqual({ kind: "present" });
    expect(receivedSignal).toBe(signal);
  });

  test("AC-002 pending false を absent に変換する", async () => {
    const port = createMfaChallengePort({
      getChallenge: async () => ({ pending: false }),
      verifyChallenge: async () => ({ redirect_url: "/account" }),
    });

    expect(await port.observe(new AbortController().signal)).toEqual({ kind: "absent" });
  });

  test("AC-003 GET の通信失敗を unavailable に変換する", async () => {
    const port = createMfaChallengePort({
      getChallenge: async () => {
        throw new TypeError("network unavailable");
      },
      verifyChallenge: async () => ({ redirect_url: "/account" }),
    });

    expect(await port.observe(new AbortController().signal)).toEqual({ kind: "unavailable" });
  });

  test("AC-004/017 Abort だけは unavailable に丸めず呼出側へ返す", async () => {
    const aborted = new DOMException("The operation was aborted", "AbortError");
    const controller = new AbortController();
    controller.abort();
    const port = createMfaChallengePort({
      getChallenge: async () => {
        throw aborted;
      },
      verifyChallenge: async () => ({ redirect_url: "/account" }),
    });

    await expect(port.observe(controller.signal)).rejects.toBe(aborted);
  });

  test("AC-005 verify success をcamelCaseのpassedへ変換する", async () => {
    let receivedInput: { code: string; kind: "totp" | "recovery_code" } | undefined;
    const port = createMfaChallengePort({
      getChallenge: async () => ({ pending: true }),
      verifyChallenge: async (input) => {
        receivedInput = input;
        return { redirect_url: "/account/security" };
      },
    });
    const input = { code: "123456", kind: "totp" } as const;

    const result = await port.verify(input);

    expect(result).toEqual({ kind: "passed", redirectUrl: "/account/security" });
    expect(receivedInput).toEqual(input);
  });

  test("AC-006/007/010/011/026-032 MfaApiError のcodeをrejectedへ保つ", async () => {
    const port = createMfaChallengePort({
      getChallenge: async () => ({ pending: true }),
      verifyChallenge: async () => {
        throw new MfaApiError(401, "challenge_expired");
      },
    });

    expect(await port.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "challenge_expired",
    });
  });

  test("AC-012 verify の未知throwをunknownへ縮退する", async () => {
    const port = createMfaChallengePort({
      getChallenge: async () => ({ pending: true }),
      verifyChallenge: async () => {
        throw new TypeError("network unavailable");
      },
    });

    expect(await port.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "unknown",
    });
  });
});
