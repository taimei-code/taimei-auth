import { test, expect, describe } from "bun:test";
import { Option, Schema } from "effect";
import { RedirectTarget, SignInParams } from "../sign-in-params";

const decodeSignInParams = Schema.decodeUnknownOption(SignInParams);
const decodeRedirectTarget = Schema.decodeUnknownOption(RedirectTarget);

describe("sign-in の query の検査", () => {
  describe("正常系", () => {
    test("必須2項目 (service_name + redirect_url) で parse 成功", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/dashboard",
      });
      expect(Option.isSome(result)).toBe(true);
    });

    test("sign_up_url は optional, 渡せば parse 成功", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/",
        sign_up_url: "https://app.taimei-code.com/signup",
      });
      expect(Option.isSome(result)).toBe(true);
    });

    test("accounts service は auth subdomain で parse 成功", () => {
      const result = decodeSignInParams({
        service_name: "accounts",
        redirect_url: "https://auth.taimei-code.com/account",
      });
      expect(Option.isSome(result)).toBe(true);
    });
  });

  describe("異常系", () => {
    test("未知の service_name は parse 失敗", () => {
      const result = decodeSignInParams({
        service_name: "unknown",
        redirect_url: "https://app.taimei-code.com/",
      });
      expect(Option.isSome(result)).toBe(false);
    });

    test("redirect_url が allowlist 外は parse 失敗", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "https://evil.com/",
      });
      expect(Option.isSome(result)).toBe(false);
    });

    test("redirect_url が他プロダクト host (service_name 不一致) は parse 失敗", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "https://auth.taimei-code.com/",
      });
      expect(Option.isSome(result)).toBe(false);
    });

    test("sign_up_url が allowlist 外は parse 失敗", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/",
        sign_up_url: "https://evil.com/signup",
      });
      expect(Option.isSome(result)).toBe(false);
    });
  });

  describe("境界値", () => {
    test("redirect_url 空文字は parse 失敗 (min=1)", () => {
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: "",
      });
      expect(Option.isSome(result)).toBe(false);
    });

    test("redirect_url 2048 文字は parse 成功", () => {
      const base = "https://app.taimei-code.com/";
      const url = base + "a".repeat(2048 - base.length);
      expect(url.length).toBe(2048);
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: url,
      });
      expect(Option.isSome(result)).toBe(true);
    });

    test("redirect_url 2049 文字は parse 失敗 (max=2048)", () => {
      const base = "https://app.taimei-code.com/";
      const url = base + "a".repeat(2049 - base.length);
      expect(url.length).toBe(2049);
      const result = decodeSignInParams({
        service_name: "taimei",
        redirect_url: url,
      });
      expect(Option.isSome(result)).toBe(false);
    });

    test("service_name 大文字小文字混在は parse 失敗 (enum 厳格)", () => {
      const result = decodeSignInParams({
        service_name: "Taimei",
        redirect_url: "https://app.taimei-code.com/",
      });
      expect(Option.isSome(result)).toBe(false);
    });
  });
});

describe("戻り先の組の検査", () => {
  const target = {
    service_name: "taimei",
    redirect_url: "https://app.taimei-code.com/dashboard",
  } as const;

  test("allowlist 内の組は同じ 2 項目で返る", () => {
    expect(Schema.decodeSync(RedirectTarget)(target)).toEqual(target);
  });

  test("redirect_url が allowlist 外は parse 失敗", () => {
    const result = decodeRedirectTarget({
      ...target,
      redirect_url: "https://evil.example.com/dashboard",
    });
    expect(Option.isSome(result)).toBe(false);
  });

  test("片方だけは parse 失敗", () => {
    expect(Option.isSome(decodeRedirectTarget({ service_name: "taimei" }))).toBe(false);
    expect(Option.isSome(decodeRedirectTarget({ redirect_url: target.redirect_url }))).toBe(false);
  });

  test("redirect_url は 2048 文字まで", () => {
    const base = "https://app.taimei-code.com/";
    const ofLength = (n: number) => base + "a".repeat(n - base.length);
    expect(Option.isSome(decodeRedirectTarget({ ...target, redirect_url: ofLength(2048) }))).toBe(
      true,
    );
    expect(Option.isSome(decodeRedirectTarget({ ...target, redirect_url: ofLength(2049) }))).toBe(
      false,
    );
  });
});
