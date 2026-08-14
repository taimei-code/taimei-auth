import { describe, expect, test } from "bun:test";
import { MfaApiError, resolveMfaErrorCode, type MfaCodeKind, type MfaErrorCode } from "../mfa-api";
import { describeMfaChallengeError, normalizeMfaCode } from "../use-mfa-code-entry";

type NormalizeCase = { name: string; raw: string; kind: MfaCodeKind; normalized: string };

const NORMALIZE_CASES: NormalizeCase[] = [
  { name: "全角数字", raw: "１２３４５６", kind: "totp", normalized: "123456" },
  { name: "半角空白入り", raw: "12 34 56", kind: "totp", normalized: "123456" },
  { name: "全角空白入り", raw: "１２３　４５６", kind: "totp", normalized: "123456" },
  { name: "前後の空白と改行", raw: " 012345\n", kind: "totp", normalized: "012345" },
  { name: "TOTP のハイフンは飾りなので落とす", raw: "123-456", kind: "totp", normalized: "123456" },
  {
    name: "TOTP のダッシュ類 (U+2010) も落とす",
    raw: "123‐456",
    kind: "totp",
    normalized: "123456",
  },
  { name: "TOTP の長音記号も落とす", raw: "123ー456", kind: "totp", normalized: "123456" },
  { name: "空文字はそのまま", raw: "", kind: "totp", normalized: "" },
  {
    name: "リカバリーコードのハイフンは保つ",
    raw: "abcde-fghij",
    kind: "recovery_code",
    normalized: "abcde-fghij",
  },
  {
    name: "リカバリーコードの全角は半角に畳む",
    raw: "ａｂｃｄｅ－ｆｇｈｉｊ",
    kind: "recovery_code",
    normalized: "abcde-fghij",
  },
  {
    name: "リカバリーコードのダッシュ類 (U+2010) は ASCII ハイフンへ",
    raw: "abcde‐fghij",
    kind: "recovery_code",
    normalized: "abcde-fghij",
  },
  {
    name: "リカバリーコードの負符号 (U+2212) は ASCII ハイフンへ",
    raw: "abcde−fghij",
    kind: "recovery_code",
    normalized: "abcde-fghij",
  },
  {
    name: "リカバリーコードの長音記号 + 空白は ASCII ハイフンへ",
    raw: "abcde ー fghij",
    kind: "recovery_code",
    normalized: "abcde-fghij",
  },
  {
    name: "リカバリーコードの大文字小文字は保つ",
    raw: "ABCDE-fghij",
    kind: "recovery_code",
    normalized: "ABCDE-fghij",
  },
];

const ALL_ERROR_CODES: MfaErrorCode[] = [
  "invalid_code",
  "challenge_expired",
  "locked",
  "rate_limited",
  "already_enabled",
  "enrollment_changed",
  "temporarily_unavailable",
  "not_enabled",
  "invalid_argument",
  "unauthorized",
  "not_found",
  "unknown",
];

const AVOID_TERMS = [
  "2FA",
  "二要素認証",
  "バックアップコード",
  "twoFactor",
  "ワンタイムパスワード",
];

describe("normalizeMfaCode", () => {
  test.each(NORMALIZE_CASES)("QA-D-08 $name → $normalized", ({
    raw,
    kind,
    normalized,
  }: NormalizeCase) => {
    expect(normalizeMfaCode(raw, kind)).toBe(normalized);
  });

  test("QA-M-23 先頭 0 の 6 桁は string のまま保たれる", () => {
    const normalized = normalizeMfaCode("０１２３４５", "totp");

    expect(normalized).toBe("012345");
    expect(typeof normalized).toBe("string");
    expect(normalized).not.toBe(String(Number(normalized)));
    expect(normalized).toHaveLength(6);
  });

  test("QA-M-23 全角混じりの先頭 0 も桁を落とさない", () => {
    expect(normalizeMfaCode("0１2３4５", "totp")).toBe("012345");
    expect(normalizeMfaCode("00 00 00", "totp")).toBe("000000");
  });

  test("QA-D-08 リカバリーコードは正規化してもサーバ比較用の形に往復する", () => {
    const issued = "abcde-fghij";
    const pastedFromMail = "　ａｂｃｄｅ − ｆｇｈｉｊ　";

    expect(normalizeMfaCode(pastedFromMail, "recovery_code")).toBe(issued);
    expect(normalizeMfaCode(issued, "recovery_code")).toBe(issued);
  });
});

describe("describeMfaChallengeError", () => {
  test.each(ALL_ERROR_CODES)("QA-E-11 %s の文言にエラーコードを露出しない", (code: string) => {
    const message = describeMfaChallengeError(code);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(code);
    expect(message).not.toContain("_");
    expect(message).not.toMatch(/[A-Z]{4,}/);
  });

  test.each(ALL_ERROR_CODES)("QA-E-11 %s の文言が canonical 用語に従う", (code: string) => {
    const message = describeMfaChallengeError(code);

    for (const avoided of AVOID_TERMS) {
      expect({ code, avoided, contained: message.includes(avoided) }).toEqual({
        code,
        avoided,
        contained: false,
      });
    }
  });

  test("QA-E-11 多要素認証に言及する文言は canonical 表記を使う", () => {
    expect(describeMfaChallengeError("already_enabled")).toContain("多要素認証 (MFA)");
  });

  test("QA-E-11 invalid_code は再試行を促さない (チャレンジ破棄済みの場合があるため)", () => {
    const message = describeMfaChallengeError("invalid_code");

    expect(message).toBe("入力されたコードが正しくありません。");
    expect(message).not.toContain("もう一度");
  });

  test("QA-E-11 未知コードと prototype メンバー名は既定文言へ縮退する", () => {
    const generic = describeMfaChallengeError("unknown");

    expect(describeMfaChallengeError("SOMETHING_NEW")).toBe(generic);
    expect(describeMfaChallengeError("toString")).toBe(generic);
    expect(describeMfaChallengeError("constructor")).toBe(generic);
  });

  test("QA-E-11 ロックアウトと rate limit は待ち時間の違う別文言になる", () => {
    const locked = describeMfaChallengeError("locked");
    const rateLimited = describeMfaChallengeError("rate_limited");

    expect(locked).not.toBe(rateLimited);
    expect(locked).toContain("15 分");
    expect(rateLimited).not.toContain("15 分");
  });
});

describe("resolveMfaErrorCode", () => {
  const cases: {
    name: string;
    status: number;
    wireError: string | undefined;
    code: MfaErrorCode;
  }[] = [
    { name: "429 + error 無し", status: 429, wireError: undefined, code: "rate_limited" },
    { name: "429 + locked", status: 429, wireError: "locked", code: "locked" },
    {
      name: "429 + Too Many Requests (proxy 文言)",
      status: 429,
      wireError: "Too Many Requests",
      code: "rate_limited",
    },
    { name: "400 + invalid_code", status: 400, wireError: "invalid_code", code: "invalid_code" },
    {
      name: "401 + challenge_expired",
      status: 401,
      wireError: "challenge_expired",
      code: "challenge_expired",
    },
    {
      name: "409 + already_enabled",
      status: 409,
      wireError: "already_enabled",
      code: "already_enabled",
    },
    { name: "500 + error 無し", status: 500, wireError: undefined, code: "unknown" },
    { name: "400 + prototype メンバー名", status: 400, wireError: "toString", code: "unknown" },
  ];

  test.each(cases)("QA-E-11 $name → $code", ({ status, wireError, code }) => {
    expect(resolveMfaErrorCode(status, wireError)).toBe(code);
  });

  test("QA-E-11 同じ 429 でも locked と rate_limited を取り違えない", () => {
    expect(resolveMfaErrorCode(429, "locked")).not.toBe(resolveMfaErrorCode(429, undefined));
  });

  test("QA-E-11 MfaApiError は code を保持し message には汎用文言だけを載せる", () => {
    const error = new MfaApiError(429, resolveMfaErrorCode(429, "locked"));

    expect(error.code).toBe("locked");
    expect(error.status).toBe(429);
    expect(error.message).not.toContain("locked");
    expect(error.message).not.toContain("_");
  });
});
