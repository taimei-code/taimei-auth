import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MFA_FAILURE_MESSAGES, type MfaCodeKind } from "../mfa-atom";
import { normalizeMfaCode, useMfaCodeInput, type MfaCodeInput } from "../use-mfa-code-entry";

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

const AVOID_TERMS = [
  "2FA",
  "二要素認証",
  "バックアップコード",
  "twoFactor",
  "ワンタイムパスワード",
];

describe("normalizeMfaCode", () => {
  test.each(NORMALIZE_CASES)("$name → $normalized", ({ raw, kind, normalized }: NormalizeCase) => {
    expect(normalizeMfaCode(raw, kind)).toBe(normalized);
  });

  test("先頭 0 の 6 桁は string のまま保たれる", () => {
    const normalized = normalizeMfaCode("０１２３４５", "totp");

    expect(normalized).toBe("012345");
    expect(typeof normalized).toBe("string");
    expect(normalized).not.toBe(String(Number(normalized)));
    expect(normalized).toHaveLength(6);
  });

  test("全角混じりの先頭 0 も桁を落とさない", () => {
    expect(normalizeMfaCode("0１2３4５", "totp")).toBe("012345");
    expect(normalizeMfaCode("00 00 00", "totp")).toBe("000000");
  });

  test("リカバリーコードは正規化してもサーバ比較用の形に往復する", () => {
    const issued = "abcde-fghij";
    const pastedFromMail = "　ａｂｃｄｅ − ｆｇｈｉｊ　";

    expect(normalizeMfaCode(pastedFromMail, "recovery_code")).toBe(issued);
    expect(normalizeMfaCode(issued, "recovery_code")).toBe(issued);
  });
});

describe("MFA_FAILURE_MESSAGES", () => {
  const entries = Object.entries(MFA_FAILURE_MESSAGES);

  test.each(entries)("%s の文言に失敗の名前を露出しない", (tag, message) => {
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(tag);
    expect(message).not.toContain("_");
    expect(message).not.toMatch(/[A-Z]{4,}/);
  });

  test.each(entries)("%s の文言が canonical 用語に従う", (tag, message) => {
    for (const avoided of AVOID_TERMS) {
      expect({ tag, avoided, contained: message.includes(avoided) }).toEqual({
        tag,
        avoided,
        contained: false,
      });
    }
  });

  test("多要素認証に言及する文言は canonical 表記を使う", () => {
    expect(MFA_FAILURE_MESSAGES.AlreadyEnabled).toContain("多要素認証 (MFA)");
  });

  test("InvalidCode は再試行を促さない (チャレンジ破棄済みの場合があるため)", () => {
    expect(MFA_FAILURE_MESSAGES.InvalidCode).toBe("入力されたコードが正しくありません。");
    expect(MFA_FAILURE_MESSAGES.InvalidCode).not.toContain("もう一度");
  });

  test("Locked は試行枠の使い切りと計数できない時の両方で返るので、どちらの場合にも合う文言にする", () => {
    expect(MFA_FAILURE_MESSAGES.Locked).toContain("上限");
    expect(MFA_FAILURE_MESSAGES.Locked).toContain("一時的");
    expect(MFA_FAILURE_MESSAGES.Locked).toContain("15 分");
  });

  test("ロックアウトと試行枠は待ち時間の違う別文言になる", () => {
    expect(MFA_FAILURE_MESSAGES.Locked).not.toBe(MFA_FAILURE_MESSAGES.RateLimited);
    expect(MFA_FAILURE_MESSAGES.RateLimited).not.toContain("15 分");
  });
});

describe("useMfaCodeInput", () => {
  test("controlled submitting と error を入力属性へ反映する", () => {
    let observed: MfaCodeInput | undefined;
    const Probe = () => {
      observed = useMfaCodeInput({
        inputId: "mfa-probe",
        submitting: true,
        errorMessage: "入力されたコードが正しくありません。",
        submit: () => undefined,
      });
      return null;
    };

    renderToStaticMarkup(createElement(Probe));

    expect(observed?.submitting).toBe(true);
    expect(observed?.canSubmit).toBe(false);
    expect(observed?.errorMessage).toBe("入力されたコードが正しくありません。");
    expect(observed?.inputProps.disabled).toBe(true);
    expect(observed?.inputProps["aria-invalid"]).toBe(true);
    expect(observed?.inputProps["aria-describedby"]).toBe("mfa-probe-hint mfa-probe-error");
  });
});
