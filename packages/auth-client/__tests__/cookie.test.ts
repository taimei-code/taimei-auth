import { describe, expect, test } from "bun:test";
import type { CookieReader } from "../src/cookie";
import {
  buildSessionCookieHeader,
  extractSessionTokenFromCookieHeader,
  getSessionToken,
  hasAuthCookie,
} from "../src/cookie";

const makeReader = (entries: Record<string, string>): CookieReader => {
  return (name) => entries[name];
};

describe("hasAuthCookie", () => {
  test("HTTP 用 cookie 名が存在すれば true", () => {
    expect(hasAuthCookie(makeReader({ "better-auth.session_token": "tok" }))).toBe(true);
  });

  test("HTTPS 用 (__Secure- prefix) cookie 名が存在すれば true", () => {
    expect(hasAuthCookie(makeReader({ "__Secure-better-auth.session_token": "tok" }))).toBe(true);
  });

  test("無関係な cookie のみなら false", () => {
    expect(hasAuthCookie(makeReader({ "other.cookie": "x" }))).toBe(false);
  });

  test("空 cookie 値は未存在扱い (false)", () => {
    expect(hasAuthCookie(makeReader({ "better-auth.session_token": "" }))).toBe(false);
  });
});

describe("getSessionToken", () => {
  test("HTTP 用 cookie の値を返す", () => {
    expect(getSessionToken(makeReader({ "better-auth.session_token": "tok-http" }))).toBe(
      "tok-http",
    );
  });

  test("両方存在する場合は配列順 (HTTP 名が先) に従い HTTP 側を返す", () => {
    // 実運用では HTTP/HTTPS どちらか一方しか発行されないため、両立は理論ケース。
    expect(
      getSessionToken(
        makeReader({
          "better-auth.session_token": "tok-http",
          "__Secure-better-auth.session_token": "tok-https",
        }),
      ),
    ).toBe("tok-http");
  });

  test("HTTPS 用のみ存在する場合は HTTPS の値", () => {
    expect(getSessionToken(makeReader({ "__Secure-better-auth.session_token": "tok-https" }))).toBe(
      "tok-https",
    );
  });

  test("どちらも無ければ undefined", () => {
    expect(getSessionToken(makeReader({}))).toBeUndefined();
  });
});

describe("extractSessionTokenFromCookieHeader", () => {
  test("先頭/中間/末尾どの位置にあっても抽出できる", () => {
    expect(extractSessionTokenFromCookieHeader("better-auth.session_token=tok-1; foo=bar")).toBe(
      "tok-1",
    );
    expect(
      extractSessionTokenFromCookieHeader("foo=bar; better-auth.session_token=tok-2; baz=qux"),
    ).toBe("tok-2");
    expect(extractSessionTokenFromCookieHeader("foo=bar; better-auth.session_token=tok-3")).toBe(
      "tok-3",
    );
  });

  test("__Secure- prefix も抽出できる", () => {
    expect(
      extractSessionTokenFromCookieHeader("__Secure-better-auth.session_token=tok-secure"),
    ).toBe("tok-secure");
  });

  test("空文字列は undefined", () => {
    expect(extractSessionTokenFromCookieHeader("")).toBeUndefined();
  });

  test("該当 cookie が無ければ undefined", () => {
    expect(extractSessionTokenFromCookieHeader("foo=bar; baz=qux")).toBeUndefined();
  });

  test("空値 cookie (=以降が空) は undefined (他 helper との一貫性)", () => {
    expect(extractSessionTokenFromCookieHeader("better-auth.session_token=")).toBeUndefined();
    expect(
      extractSessionTokenFromCookieHeader("foo=bar; better-auth.session_token=  ; baz=qux"),
    ).toBeUndefined();
  });

  test("値の前後の空白を trim する", () => {
    expect(extractSessionTokenFromCookieHeader("better-auth.session_token=  spaced  ")).toBe(
      "spaced",
    );
  });

  test("値に '=' が含まれていても全体を返す (split ではなく indexOf で 1 回区切り)", () => {
    // JWT 形式やパディング含みの token は '=' を含む可能性があるため、最初の '=' のみを区切りとして扱う。
    expect(extractSessionTokenFromCookieHeader("better-auth.session_token=tok=abc=def")).toBe(
      "tok=abc=def",
    );
  });
});

// server 側の発行者との往復は src/__tests__/session-cookie-contract.test.ts が固定する (CONTEXT.md「session cookie」)。
describe("session cookie 契約の SDK 側", () => {
  // 44 文字の標準 base64 署名 (`+` `/` `=` を含む) を模した raw 値。
  const SIGNED = `tok-abc.${"A".repeat(20)}+/${"B".repeat(21)}=`;

  test("build → extract の往復で + / = を含む raw 値がそのまま戻る", () => {
    expect(extractSessionTokenFromCookieHeader(buildSessionCookieHeader(SIGNED))).toBe(SIGNED);
  });

  test("percent-encoded な値を decode しない", () => {
    expect(extractSessionTokenFromCookieHeader("better-auth.session_token=abc%2Bdef%3D")).toBe(
      "abc%2Bdef%3D",
    );
  });

  test("SESSION_COOKIE_NAMES は export されない (ADR-0006)", async () => {
    const keys = Object.keys(await import("../src/index"));
    expect(keys).toContain("getSessionToken");
    expect(keys).not.toContain("SESSION_COOKIE_NAMES");
  });
});
