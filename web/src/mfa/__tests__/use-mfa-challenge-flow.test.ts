import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mfaChallengePort } from "../use-mfa-challenge-flow";

// production port の実体を fetch spy で検証する。stub 化した api object を挟まないのは、
// HTTP 変換 (mfa-api の resolveMfaErrorCode まで) を実チェーンで通し、テスト注入点を
// useMfaChallengeFlow(port) の 1 つに保つため。

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

describe("mfaChallengePort.observe", () => {
  test("AC-001/018 pending true を present に変換し AbortSignal を fetch へ渡す", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ pending: true }));
    const signal = new AbortController().signal;

    const result = await mfaChallengePort.observe(signal);

    expect(result).toEqual({ kind: "present" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/mfa/challenge");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", signal });
  });

  test("AC-002 pending false を absent に変換する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ pending: false }));

    expect(await mfaChallengePort.observe(new AbortController().signal)).toEqual({
      kind: "absent",
    });
  });

  test("AC-003 GET の通信失敗を unavailable に変換する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));

    expect(await mfaChallengePort.observe(new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });

  test("AC-004/017 Abort だけは unavailable に丸めず呼出側へ返す", async () => {
    const aborted = new DOMException("The operation was aborted", "AbortError");
    const controller = new AbortController();
    controller.abort();
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(aborted);

    await expect(mfaChallengePort.observe(controller.signal)).rejects.toBe(aborted);
  });

  test("GET の非 2xx 応答も unavailable に縮退する", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 503));

    expect(await mfaChallengePort.observe(new AbortController().signal)).toEqual({
      kind: "unavailable",
    });
  });

  test("pending を持たない 2xx を absent と推測しない (ADR-0013 §9)", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    expect(await mfaChallengePort.observe(new AbortController().signal)).toEqual({
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

  test("AC-006/007/010/011/026-032 wire の error code を rejected へ保つ", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "challenge_expired" }, 401),
    );

    expect(await mfaChallengePort.verify({ code: "123456", kind: "totp" })).toEqual({
      kind: "rejected",
      errorCode: "challenge_expired",
    });
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
