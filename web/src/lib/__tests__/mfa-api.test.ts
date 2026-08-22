import { afterEach, expect, spyOn, test } from "bun:test";
import { getMfaChallenge, MfaApiError, mfaErrorCodeOf } from "../mfa-api";

let fetchSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

test("AC-018 getMfaChallenge は caller の AbortSignal を fetch へ渡す", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ pending: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  const signal = new AbortController().signal;

  const result = await getMfaChallenge(signal);

  expect(result).toEqual({ pending: true });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", signal });
});

test("mfaErrorCodeOf は MfaApiError の code を保つ", () => {
  expect(mfaErrorCodeOf(new MfaApiError(401, "challenge_expired"))).toBe("challenge_expired");
  expect(mfaErrorCodeOf(new MfaApiError(429, "locked"))).toBe("locked");
});

test("mfaErrorCodeOf は非 MfaApiError を unknown へ縮退する", () => {
  expect(mfaErrorCodeOf(new TypeError("network unavailable"))).toBe("unknown");
  expect(mfaErrorCodeOf(undefined)).toBe("unknown");
  expect(mfaErrorCodeOf("challenge_expired")).toBe("unknown");
});
