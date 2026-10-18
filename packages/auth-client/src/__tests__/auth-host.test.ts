import { describe, expect, test } from "bun:test";
import {
  AUTH_RPC_PATH,
  COMPANY_ID_PATTERN,
  isJustSignedUp,
  MAGIC_LINK_EXPIRES_IN_SECONDS,
  type SessionData,
} from "../index";

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

  describe("新規登録の直後", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const data: SessionData = {
      user: {
        id: "u1",
        name: "n",
        email: "e",
        emailVerified: true,
        createdAt,
        updatedAt: createdAt,
      },
      session: { id: "s1", expiresAt: "", kind: "user" },
    };
    const justSignedUpEndsAt = Date.parse(createdAt) + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000;

    test("user を作ってから Magic Link の有効期限の内側なら新規登録の直後である", () => {
      expect(isJustSignedUp(data, justSignedUpEndsAt - 1)).toBe(true);
    });

    test("Magic Link の有効期限ちょうどは新規登録の直後ではない", () => {
      expect(isJustSignedUp(data, justSignedUpEndsAt)).toBe(false);
    });

    test("1 日前に作った user は新規登録の直後ではない", () => {
      expect(isJustSignedUp(data, Date.parse(createdAt) + 24 * 60 * 60 * 1000)).toBe(false);
    });
  });
});
