import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { TWO_FACTOR_ERROR_CODES } from "better-auth/plugins";
import { setSentryBackend, type CaptureContext } from "../../sentry";
import { CHALLENGE_EXPIRED, failure, mapTwoFactorError, type MfaError } from "../error-mapping";

type Captured = { message: string; context?: CaptureContext };

let captured: Captured[] = [];

const spyBackend = {
  captureException: () => {},
  captureMessage: (message: string, context?: CaptureContext) => {
    captured.push({ message, context });
  },
};

// Sentry backend は module-global で、戻し忘れは後続 test file に漏れる。
const consoleFallback = {
  captureException: (error: unknown) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message: string, context?: CaptureContext) =>
    console.warn("[sentry:noop] captureMessage", message, context?.tags),
};

const apiErrorWithCode = (code: string): unknown => ({ status: "BAD_REQUEST", body: { code } });

const UNMAPPED_MESSAGE = "mfa: unmapped two factor error";
const BUDGET_EXHAUSTED_MESSAGE = "mfa: verification attempt budget exhausted";

type PluginCodeCase = {
  pluginCode: string;
  expected: MfaError;
  reported: boolean;
};

const PLUGIN_CODE_CASES: PluginCodeCase[] = [
  { pluginCode: "INVALID_CODE", expected: { error: "invalid_code", status: 400 }, reported: false },
  {
    pluginCode: "INVALID_BACKUP_CODE",
    expected: { error: "invalid_code", status: 400 },
    reported: false,
  },
  {
    pluginCode: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
    expected: { error: "invalid_code", status: 400 },
    reported: true,
  },
  {
    pluginCode: "ACCOUNT_TEMPORARILY_LOCKED",
    expected: { error: "locked", status: 429 },
    reported: true,
  },
  {
    pluginCode: "INVALID_TWO_FACTOR_COOKIE",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
  {
    pluginCode: "OTP_NOT_ENABLED",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
  {
    pluginCode: "OTP_HAS_EXPIRED",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
  {
    pluginCode: "TOTP_NOT_ENABLED",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
  {
    pluginCode: "TWO_FACTOR_NOT_ENABLED",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
  {
    pluginCode: "BACKUP_CODES_NOT_ENABLED",
    expected: { error: "challenge_expired", status: 401 },
    reported: false,
  },
];

describe("mapTwoFactorError", () => {
  beforeEach(() => {
    captured = [];
    setSentryBackend(spyBackend);
  });

  afterAll(() => {
    setSentryBackend(consoleFallback);
  });

  test("QA-M-11 写像表がプラグインの全エラーコードを 1 つ残らず覆う", () => {
    expect(PLUGIN_CODE_CASES.map((c) => c.pluginCode).sort()).toEqual(
      Object.keys(TWO_FACTOR_ERROR_CODES).sort(),
    );
  });

  test.each(PLUGIN_CODE_CASES)("QA-M-11 $pluginCode → $expected.error / $expected.status", ({
    pluginCode,
    expected,
    reported,
  }: PluginCodeCase) => {
    expect(mapTwoFactorError(apiErrorWithCode(pluginCode))).toEqual(expected);

    const unmapped = captured.filter((c) => c.message === UNMAPPED_MESSAGE);
    expect(unmapped).toHaveLength(0);

    const budget = captured.filter((c) => c.message === BUDGET_EXHAUSTED_MESSAGE);
    expect(budget).toHaveLength(reported ? 1 : 0);
    if (reported) {
      expect(budget[0]?.context?.level).toBe("warning");
      expect(budget[0]?.context?.tags).toEqual({
        component: "mfa-error-mapping",
        pluginCode,
      });
    }
  });

  test("QA-M-11 ロックアウトと試行上限超過は別 status で返る (429 と 400)", () => {
    expect(mapTwoFactorError(apiErrorWithCode("ACCOUNT_TEMPORARILY_LOCKED"))).toEqual({
      error: "locked",
      status: 429,
    });
    expect(mapTwoFactorError(apiErrorWithCode("TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"))).toEqual({
      error: "invalid_code",
      status: 400,
    });
  });

  const unknownShapes: { name: string; error: unknown }[] = [
    { name: "未知コード", error: apiErrorWithCode("SOMETHING_NEW_IN_UPSTREAM") },
    { name: "prototype chain のメンバー名 (toString)", error: apiErrorWithCode("toString") },
    { name: "prototype chain のメンバー名 (constructor)", error: apiErrorWithCode("constructor") },
    { name: "body 無しの Error", error: new Error("boom") },
    { name: "body が非オブジェクト", error: { body: "nope" } },
    { name: "code が非文字列", error: { body: { code: 42 } } },
    { name: "null", error: null },
    { name: "undefined", error: undefined },
    { name: "文字列", error: "INVALID_CODE" },
  ];

  test.each(
    unknownShapes,
  )("QA-M-11 $name は challenge_expired へ fail-closed し Sentry に error で載る", ({
    error,
  }: {
    error: unknown;
  }) => {
    expect(mapTwoFactorError(error)).toEqual(CHALLENGE_EXPIRED);
    expect(mapTwoFactorError(error)).toEqual({ error: "challenge_expired", status: 401 });

    const unmapped = captured.filter((c) => c.message === UNMAPPED_MESSAGE);
    expect(unmapped).toHaveLength(2);
    expect(unmapped[0]?.context?.level).toBe("error");
    expect(unmapped[0]?.context?.tags?.component).toBe("mfa-error-mapping");
  });

  test("QA-M-11 failure() は handler が 1 行で HTTP に落とせる形を返す", () => {
    expect(failure(mapTwoFactorError(apiErrorWithCode("INVALID_CODE")))).toEqual({
      ok: false,
      error: "invalid_code",
      status: 400,
    });
  });
});
