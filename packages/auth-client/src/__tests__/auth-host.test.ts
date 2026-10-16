import { describe, expect, test } from "bun:test";
import { AUTH_RPC_PATH, COMPANY_ID_PATTERN, MAGIC_LINK_EXPIRES_IN_SECONDS } from "../index";

describe("auth ホストの決めごと", () => {
  test("RPC は /rpc の下に mount されている", () => {
    expect(AUTH_RPC_PATH).toBe("/rpc");
  });

  test("Magic Link の有効期限は 300 秒", () => {
    expect(MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(300);
  });

  describe("事業所 id の形", () => {
    const twentyFourIdChars = "V1StGXR8_Z5jdHi6B-myT0aB";

    test("cmp_ に URL で使える 24 文字が続く id は事業所 id である", () => {
      expect(COMPANY_ID_PATTERN.test(`cmp_${twentyFourIdChars}`)).toBe(true);
    });

    test("24 文字に 1 文字足りない id は事業所 id ではない", () => {
      expect(COMPANY_ID_PATTERN.test(`cmp_${twentyFourIdChars.slice(1)}`)).toBe(false);
    });

    test("24 文字を 1 文字超える id は事業所 id ではない", () => {
      expect(COMPANY_ID_PATTERN.test(`cmp_${twentyFourIdChars}a`)).toBe(false);
    });

    test("cmp_ 以外で始まる id は事業所 id ではない", () => {
      expect(COMPANY_ID_PATTERN.test(`mbr_${twentyFourIdChars}`)).toBe(false);
    });

    test("URL で使えない文字を含む id は事業所 id ではない", () => {
      expect(COMPANY_ID_PATTERN.test(`cmp_${twentyFourIdChars.slice(1)}.`)).toBe(false);
    });
  });
});
