import { test, expect, describe } from "bun:test";
import { redirectTargetSchema, signInParamsSchema } from "../sign-in-params";

describe("signInParamsSchema", () => {
  describe("正常系", () => {
    test("必須2項目 (service_name + redirect_url) で parse 成功", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/dashboard",
      });
      expect(result.success).toBe(true);
    });

    test("sign_up_url は optional, 渡せば parse 成功", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/",
        sign_up_url: "https://app.taimei-code.com/signup",
      });
      expect(result.success).toBe(true);
    });

    test("accounts service は auth subdomain で parse 成功", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "accounts",
        redirect_url: "https://auth.taimei-code.com/account",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("異常系", () => {
    test("未知の service_name は parse 失敗", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "unknown",
        redirect_url: "https://app.taimei-code.com/",
      });
      expect(result.success).toBe(false);
    });

    test("redirect_url が allowlist 外は parse 失敗", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "https://evil.com/",
      });
      expect(result.success).toBe(false);
    });

    test("redirect_url が他プロダクト host (service_name 不一致) は parse 失敗", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "https://auth.taimei-code.com/",
      });
      expect(result.success).toBe(false);
    });

    test("sign_up_url が allowlist 外は parse 失敗", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "https://app.taimei-code.com/",
        sign_up_url: "https://evil.com/signup",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("境界値", () => {
    test("redirect_url 空文字は parse 失敗 (min=1)", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: "",
      });
      expect(result.success).toBe(false);
    });

    test("redirect_url 2048 文字は parse 成功", () => {
      const base = "https://app.taimei-code.com/";
      const url = base + "a".repeat(2048 - base.length);
      expect(url.length).toBe(2048);
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: url,
      });
      expect(result.success).toBe(true);
    });

    test("redirect_url 2049 文字は parse 失敗 (max=2048)", () => {
      const base = "https://app.taimei-code.com/";
      const url = base + "a".repeat(2049 - base.length);
      expect(url.length).toBe(2049);
      const result = signInParamsSchema.safeParse({
        service_name: "taimei",
        redirect_url: url,
      });
      expect(result.success).toBe(false);
    });

    test("service_name 大文字小文字混在は parse 失敗 (enum 厳格)", () => {
      const result = signInParamsSchema.safeParse({
        service_name: "Taimei",
        redirect_url: "https://app.taimei-code.com/",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("redirectTargetSchema", () => {
  const target = {
    service_name: "taimei",
    redirect_url: "https://app.taimei-code.com/dashboard",
  } as const;

  test("AC-001 allowlist 内の組は同じ 2 項目で返る", () => {
    expect(redirectTargetSchema.parse(target)).toEqual(target);
  });

  test("AC-002 redirect_url が allowlist 外は parse 失敗", () => {
    const result = redirectTargetSchema.safeParse({
      ...target,
      redirect_url: "https://evil.example.com/dashboard",
    });
    expect(result.success).toBe(false);
  });

  test("AC-003 片方だけは parse 失敗", () => {
    expect(redirectTargetSchema.safeParse({ service_name: "taimei" }).success).toBe(false);
    expect(redirectTargetSchema.safeParse({ redirect_url: target.redirect_url }).success).toBe(
      false,
    );
  });

  test("AC-039 redirect_url は 2048 文字まで", () => {
    const base = "https://app.taimei-code.com/";
    const ofLength = (n: number) => base + "a".repeat(n - base.length);
    expect(
      redirectTargetSchema.safeParse({ ...target, redirect_url: ofLength(2048) }).success,
    ).toBe(true);
    expect(
      redirectTargetSchema.safeParse({ ...target, redirect_url: ofLength(2049) }).success,
    ).toBe(false);
  });
});
