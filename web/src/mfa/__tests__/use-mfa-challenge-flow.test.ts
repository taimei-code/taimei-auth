import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mfaChallengePort } from "../use-mfa-challenge-flow";

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("mfaChallengePort.readChallengeState", () => {
  test("AC-001/018 pending true を present に変換し AbortSignal を fetch へ渡す", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ pending: true }));
    const signal = new AbortController().signal;

    const result = await mfaChallengePort.readChallengeState(signal);

    expect(result).toEqual({ kind: "present" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/mfa/challenge");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", signal });
  });

  test("AC-002 pending false を absent に変換する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ pending: false }));

    expect(await mfaChallengePort.readChallengeState(new AbortController().signal)).toEqual({
      kind: "absent",
    });
  });

  test("AC-003 GET の通信失敗を unavailable に変換する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));

    expect(await mfaChallengePort.readChallengeState(new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });

  test("AC-004/017 Abort だけは unavailable に丸めず呼出側へ返す", async () => {
    const aborted = new DOMException("The operation was aborted", "AbortError");
    const controller = new AbortController();
    controller.abort();
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(aborted);

    await expect(mfaChallengePort.readChallengeState(controller.signal)).rejects.toBe(aborted);
  });

  test("GET の非 2xx 応答も unavailable に縮退する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503));

    expect(await mfaChallengePort.readChallengeState(new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });

  test("pending を持たない 2xx を absent と推測しない (ADR-0013 §9)", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    expect(await mfaChallengePort.readChallengeState(new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });
});

describe("mfaChallengePort.verify", () => {
  test("AC-005 verify success をcamelCaseのpassedへ変換する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ redirect_url: "/account/security" }),
    );
    const input = { code: "123456", kind: "totp" } as const;

    const result = await mfaChallengePort.verify(input);

    expect(result).toEqual({ kind: "passed", redirectUrl: "/account/security" });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/mfa/challenge/verify");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify(input),
    });
  });

  test("challenge_expired は状態取得を呼ばず expired にする", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "challenge_expired" }, 401),
    );

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "expired",
    });
    expect(fetchSpy.mock.calls).toHaveLength(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/mfa/challenge/verify");
  });

  test.each([
    [400, "invalid_code"],
    [429, "locked"],
    [429, "rate_limited"],
    [409, "already_enabled"],
    [409, "enrollment_changed"],
    [409, "not_enabled"],
    [400, "invalid_argument"],
    [401, "unauthorized"],
    [404, "not_found"],
  ] as const)("%i %s は状態取得を呼ばず同じ code の rejected にする", async (status, errorCode) => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: errorCode }, status),
    );

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode,
    });
    expect(fetchSpy.mock.calls).toHaveLength(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/mfa/challenge/verify");
  });

  test("未知の error code は expired にせず unknown の rejected にする", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "unknown",
    });
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  test("redirect_url を持たない 2xx は passed にせず unknown へ倒す", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "unknown",
    });
  });

  test("AC-012 verify の未知throwをunknownへ縮退する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "unknown",
    });
  });
});
