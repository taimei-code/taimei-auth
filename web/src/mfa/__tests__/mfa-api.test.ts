import { afterEach, describe, expect, test } from "bun:test";
import { restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";
import { getMfaChallenge, mfaErrorCodeOf, verifyMfaChallenge } from "../mfa-api";

afterEach(restoreFetch);

// try/catch で sentinel を拾う形だと resolve した場合も "unknown" になり検証にならない
const codeOfRejection = (promise: Promise<unknown>): Promise<string> =>
  promise.then(() => {
    throw new Error("expected rejection");
  }, mfaErrorCodeOf);

describe("応答 → view 変換", () => {
  test("AC-021 getMfaChallenge は view 形を返す", async () => {
    stubFetch(Response.json({ pending: true }));

    expect(await getMfaChallenge()).toEqual({ pending: true });
  });

  test("AC-021 verifyMfaChallenge は redirect_url を redirectUrl へ変換し POST は一回", async () => {
    const fetchSpy = stubFetch(Response.json({ redirect_url: "/account/security" }));

    expect(await verifyMfaChallenge({ code: "123456", kind: "totp" })).toEqual({
      redirectUrl: "/account/security",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("AC-010 未知の追加 field は無視して同じ view 値を返す", async () => {
    stubFetch(Response.json({ pending: true, added_later: "x" }));

    expect(await getMfaChallenge()).toEqual({ pending: true });
  });

  test("getMfaChallenge は caller の AbortSignal を fetch へ渡す", async () => {
    const fetchSpy = stubFetch(Response.json({ pending: true }));
    const signal = new AbortController().signal;

    await getMfaChallenge(signal);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/mfa/challenge", {
      credentials: "include",
      signal,
    });
  });
});

describe("positive check — 形の崩れた 2xx を unknown へ縮退", () => {
  test.each([
    ["challenge: pending 非 boolean", () => getMfaChallenge(), { pending: "true" }],
    ["verify: redirect_url 欠け", () => verifyMfaChallenge({ code: "1", kind: "totp" }), {}],
    [
      "verify: redirect_url が空文字",
      () => verifyMfaChallenge({ code: "1", kind: "totp" }),
      { redirect_url: "" },
    ],
  ])("AC-008/009 %s", async (_name, call, body) => {
    stubFetch(Response.json(body));

    expect(await codeOfRejection(call())).toBe("unknown");
  });
});

describe("AC-011 error code 解決 (公開関数越し)", () => {
  test.each([
    ["既知 tag は対応する code", 400, { _tag: "InvalidCode" }, "invalid_code"],
    ["429 + Locked は locked", 429, { _tag: "Locked" }, "locked"],
    ["既知 tag の無い 429 は rate_limited", 429, {}, "rate_limited"],
    ["未知 tag は unknown", 500, { _tag: "Boom" }, "unknown"],
    ["proxy 文言の 429 は rate_limited", 429, { error: "Too Many Requests" }, "rate_limited"],
    ["prototype メンバー名は unknown", 400, { _tag: "toString" }, "unknown"],
    ["409 AlreadyEnabled", 409, { _tag: "AlreadyEnabled" }, "already_enabled"],
    ["MfaNotFound は not_found", 404, { _tag: "MfaNotFound" }, "not_found"],
    ["Unauthorized は unauthorized", 401, { _tag: "Unauthorized" }, "unauthorized"],
    ["body の無い 400 (入力の decode 失敗) は invalid_argument", 400, null, "invalid_argument"],
    ["非 JSON body は unknown", 503, undefined, "unknown"],
    ["前段の proxy が返す非 JSON の 400 は unknown", 400, undefined, "unknown"],
    ["401 ChallengeExpired", 401, { _tag: "ChallengeExpired" }, "challenge_expired"],
  ])("%s", async (_name, status, body, expected) => {
    stubFetch(
      body === undefined
        ? new Response("upstream error", { status })
        : body === null
          ? new Response(null, { status })
          : Response.json(body, { status }),
    );

    expect(await codeOfRejection(verifyMfaChallenge({ code: "1", kind: "totp" }))).toBe(expected);
  });
});

test("失敗の message は汎用文言のみでエラーコードを露出しない", async () => {
  stubFetch(Response.json({ _tag: "Locked" }, { status: 429 }));

  const error = await verifyMfaChallenge({ code: "1", kind: "totp" }).then(
    () => undefined,
    (rejected: unknown) => rejected,
  );

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toContain("locked");
  expect((error as Error).message).not.toContain("_");
});

test("mfaErrorCodeOf は非 MfaApiError を unknown へ縮退する", () => {
  expect(mfaErrorCodeOf(new TypeError("network unavailable"))).toBe("unknown");
  expect(mfaErrorCodeOf(undefined)).toBe("unknown");
  expect(mfaErrorCodeOf("challenge_expired")).toBe("unknown");
});
