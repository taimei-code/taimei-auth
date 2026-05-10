import { test, expect, describe } from "bun:test";
import { validateRedirectUrl } from "../url-allowlist";
import maliciousUrlsRaw from "./fixtures/malicious-redirect-urls.json";

type Fixture = { name: string; url: string; expected: boolean };
const maliciousUrls = maliciousUrlsRaw as Fixture[];

describe("validateRedirectUrl", () => {
  describe("基本動作", () => {
    test("正規 URL は true", () => {
      expect(validateRedirectUrl("https://app.taimei-code.com/", "taimei")).toBe(true);
    });

    test("不一致 host は false", () => {
      expect(validateRedirectUrl("https://evil.com/", "taimei")).toBe(false);
    });

    test("accounts service は auth subdomain のみ許可", () => {
      expect(validateRedirectUrl("https://auth.taimei-code.com/account", "accounts")).toBe(true);
      expect(validateRedirectUrl("https://app.taimei-code.com/", "accounts")).toBe(false);
    });

    test("http も許可 (e2e / dev 環境用)", () => {
      expect(validateRedirectUrl("http://app.taimei-code.com/", "taimei")).toBe(true);
    });

    test("APP_ENV 未設定 (= local 扱い) では localhost も許可", () => {
      expect(validateRedirectUrl("http://localhost:3100/account", "accounts")).toBe(true);
      expect(validateRedirectUrl("http://localhost:3100/", "taimei")).toBe(true);
    });

    test("localhost suffix attack は弾く", () => {
      expect(validateRedirectUrl("http://localhost.evil.com/", "accounts")).toBe(false);
      expect(validateRedirectUrl("http://evil-localhost/", "accounts")).toBe(false);
    });
  });

  describe("malicious URL fuzz (33 payloads)", () => {
    test.each(maliciousUrls)("$name", ({ url, expected }: Fixture) => {
      expect(validateRedirectUrl(url, "taimei")).toBe(expected);
    });
  });
});
