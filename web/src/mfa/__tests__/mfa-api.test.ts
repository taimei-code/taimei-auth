import { afterEach, describe, expect, test } from "bun:test";
import { postInit, restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";
import {
  activateMfa,
  disableMfa,
  enrollMfa,
  getMfaChallenge,
  getMfaStatus,
  mfaErrorCodeOf,
  verifyMfaChallenge,
} from "../mfa-api";

// wire fixture の形の正本は server 統合テスト (src/handlers/__tests__/account-mfa.test.ts /
// mfa-challenge.test.ts) が実 HTTP で固定している応答。ここでは公開関数越しに
// wire → view 変換・positive check・error code 解決を検証する (AC は solution_plan の ID)。

afterEach(restoreFetch);

// sentinel を try に入れて自分の catch で拾う形にすると、resolve しても "unknown" が返り
// 縮退テスト全体が空検証になる。2 引数 then で reject 経路だけを code へ写す。
const codeOfRejection = (promise: Promise<unknown>): Promise<string> =>
  promise.then(() => {
    throw new Error("expected rejection");
  }, mfaErrorCodeOf);

describe("wire → view 変換", () => {
  test("AC-006 getMfaStatus は snake wire を camel view へ変換する", async () => {
    stubFetch(Response.json({ enabled: true, in_effect: true, recovery_codes_remaining: 7 }));

    expect(await getMfaStatus()).toEqual({
      enabled: true,
      inEffect: true,
      recoveryCodesRemaining: 7,
    });
  });

  test("AC-007 enrollMfa は登録内容を camel view へ変換する", async () => {
    stubFetch(
      Response.json({
        enrollment_id: "enr-1",
        totp_uri: "otpauth://totp/x?secret=abc",
        recovery_codes: ["aaaaa-bbbbb", "ccccc-ddddd"],
      }),
    );

    expect(await enrollMfa()).toEqual({
      enrollmentId: "enr-1",
      totpUri: "otpauth://totp/x?secret=abc",
      recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"],
    });
  });

  test("AC-021 getMfaChallenge は view 形を返す", async () => {
    stubFetch(Response.json({ pending: true }));

    expect(await getMfaChallenge()).toEqual({ pending: true });
  });

  test("AC-021 verifyMfaChallenge は redirect_url を redirectUrl へ変換し POST は一回", async () => {
    const fetchSpy = stubFetch(Response.json({ redirect_url: "/account/security" }));

    expect(await verifyMfaChallenge({ code: "123456", kind: "totp" })).toEqual({
      redirectUrl: "/account/security",
    });
    // POST はチャレンジを消費するため二重発火は challenge_expired になる (ADR-0013 §9)。
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("AC-010 未知の追加 field は無視して同じ view 値を返す", async () => {
    stubFetch(
      Response.json({
        enabled: false,
        in_effect: false,
        recovery_codes_remaining: 0,
        added_later: "x",
      }),
    );

    expect(await getMfaStatus()).toEqual({
      enabled: false,
      inEffect: false,
      recoveryCodesRemaining: 0,
    });
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
    [
      "status: in_effect 欠け",
      () => getMfaStatus(),
      { enabled: true, recovery_codes_remaining: 1 },
    ],
    [
      "status: 型違い",
      () => getMfaStatus(),
      { enabled: "yes", in_effect: true, recovery_codes_remaining: 1 },
    ],
    [
      "enroll: recovery_codes 欠け",
      () => enrollMfa(),
      { enrollment_id: "enr-1", totp_uri: "otpauth://x" },
    ],
    [
      "enroll: recovery_codes に非 string 混入",
      () => enrollMfa(),
      { enrollment_id: "enr-1", totp_uri: "otpauth://x", recovery_codes: ["aaaaa", 42] },
    ],
    [
      "enroll: enrollment_id が空文字",
      () => enrollMfa(),
      { enrollment_id: "", totp_uri: "otpauth://x", recovery_codes: ["aaaaa"] },
    ],
    [
      "enroll: totp_uri が空文字",
      () => enrollMfa(),
      { enrollment_id: "enr-1", totp_uri: "", recovery_codes: ["aaaaa"] },
    ],
    [
      "enroll: recovery_codes が空配列",
      () => enrollMfa(),
      { enrollment_id: "enr-1", totp_uri: "otpauth://x", recovery_codes: [] },
    ],
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

  test("AC-008 status: 空 body も unknown へ縮退する", async () => {
    stubFetch(new Response(null, { status: 200 }));

    expect(await codeOfRejection(getMfaStatus())).toBe("unknown");
  });
});

describe("request 方向 — camel view → snake wire", () => {
  test("AC-012 activateMfa は enrollment_id で送信する", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await activateMfa({ code: "123456", enrollmentId: "enr-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/mfa/activate",
      postInit({ code: "123456", enrollment_id: "enr-1" }),
    );
  });

  test("disableMfa は code / kind をそのまま送信する", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await disableMfa({ code: "aaaaa-bbbbb", kind: "recovery_code" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/mfa/disable",
      postInit({ code: "aaaaa-bbbbb", kind: "recovery_code" }),
    );
  });
});

describe("AC-022 void endpoint は 2xx body によらず resolve する", () => {
  test.each([
    ["activateMfa 空 body", () => activateMfa({ code: "1", enrollmentId: "e" }), null],
    ["activateMfa ok body", () => activateMfa({ code: "1", enrollmentId: "e" }), { ok: true }],
    ["disableMfa 空 body", () => disableMfa({ code: "1", kind: "totp" }), null],
    ["disableMfa ok body", () => disableMfa({ code: "1", kind: "totp" }), { ok: true }],
  ] as const)("%s", async (_name, call, body) => {
    stubFetch(body === null ? new Response(null, { status: 200 }) : Response.json(body));

    await expect(call()).resolves.toBeUndefined();
  });
});

describe("AC-011 error code 解決 (公開関数越し)", () => {
  test.each([
    ["既知 wire code はそのまま", 400, { error: "invalid_code" }, "invalid_code"],
    ["429 + locked は locked", 429, { error: "locked" }, "locked"],
    ["既知 code の無い 429 は rate_limited", 429, {}, "rate_limited"],
    ["未知 code は unknown", 500, { error: "boom" }, "unknown"],
    ["proxy 文言の 429 は rate_limited", 429, { error: "Too Many Requests" }, "rate_limited"],
    ["prototype メンバー名は unknown", 400, { error: "toString" }, "unknown"],
    ["409 already_enabled", 409, { error: "already_enabled" }, "already_enabled"],
    ["非 JSON body は unknown", 503, undefined, "unknown"],
    ["401 challenge_expired", 401, { error: "challenge_expired" }, "challenge_expired"],
  ])("%s", async (_name, status, body, expected) => {
    stubFetch(
      body === undefined
        ? new Response("upstream error", { status })
        : Response.json(body, { status }),
    );

    expect(await codeOfRejection(disableMfa({ code: "1", kind: "totp" }))).toBe(expected);
  });
});

test("失敗の message は汎用文言のみでエラーコードを露出しない", async () => {
  stubFetch(Response.json({ error: "locked" }, { status: 429 }));

  const error = await disableMfa({ code: "1", kind: "totp" }).then(
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
