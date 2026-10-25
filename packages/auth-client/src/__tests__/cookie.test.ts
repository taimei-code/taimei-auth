import { describe, expect, test } from "bun:test";
import type { CookieReader } from "../cookie";
import {
  buildSessionCookieHeader,
  extractSessionTokenFromCookieHeader,
  getSessionToken,
  hasAuthCookie,
} from "../cookie";

const SESSION = "__Secure-better-auth.session_token";
const UNPREFIXED = "better-auth.session_token";

const makeReader = (entries: Record<string, string>): CookieReader => {
  return (name) => entries[name];
};

describe("hasAuthCookie", () => {
  test("__Secure- の付いた session cookie があれば true", () => {
    expect(hasAuthCookie(makeReader({ [SESSION]: "tok" }))).toBe(true);
  });

  test("__Secure- の無い名前の cookie は、Secure でない origin や隣の subdomain から書けるので読まない", () => {
    expect(hasAuthCookie(makeReader({ [UNPREFIXED]: "tok" }))).toBe(false);
  });

  test("無関係な cookie のみなら false", () => {
    expect(hasAuthCookie(makeReader({ "other.cookie": "x" }))).toBe(false);
  });

  test("空 cookie 値は未存在扱い (false)", () => {
    expect(hasAuthCookie(makeReader({ [SESSION]: "" }))).toBe(false);
  });
});

describe("getSessionToken", () => {
  test("__Secure- の付いた session cookie の値を返す", () => {
    expect(getSessionToken(makeReader({ [SESSION]: "tok-secure" }))).toBe("tok-secure");
  });

  test("__Secure- の無い名前の cookie が並んでいても、__Secure- の付いた cookie の値を返す", () => {
    expect(
      getSessionToken(makeReader({ [UNPREFIXED]: "tok-planted", [SESSION]: "tok-secure" })),
    ).toBe("tok-secure");
  });

  test("__Secure- の無い名前の cookie だけなら undefined", () => {
    expect(getSessionToken(makeReader({ [UNPREFIXED]: "tok-planted" }))).toBeUndefined();
  });

  test("どちらも無ければ undefined", () => {
    expect(getSessionToken(makeReader({}))).toBeUndefined();
  });
});

describe("extractSessionTokenFromCookieHeader", () => {
  test("先頭/中間/末尾どの位置にあっても抽出できる", () => {
    expect(extractSessionTokenFromCookieHeader(`${SESSION}=tok-1; foo=bar`)).toBe("tok-1");
    expect(extractSessionTokenFromCookieHeader(`foo=bar; ${SESSION}=tok-2; baz=qux`)).toBe("tok-2");
    expect(extractSessionTokenFromCookieHeader(`foo=bar; ${SESSION}=tok-3`)).toBe("tok-3");
  });

  test("__Secure- の無い名前の cookie が先にあっても、__Secure- の付いた cookie の値を返す", () => {
    expect(
      extractSessionTokenFromCookieHeader(`${UNPREFIXED}=tok-planted; ${SESSION}=tok-secure`),
    ).toBe("tok-secure");
  });

  test("__Secure- の無い名前の cookie だけなら undefined", () => {
    expect(extractSessionTokenFromCookieHeader(`${UNPREFIXED}=tok-planted`)).toBeUndefined();
  });

  test("空文字列は undefined", () => {
    expect(extractSessionTokenFromCookieHeader("")).toBeUndefined();
  });

  test("該当 cookie が無ければ undefined", () => {
    expect(extractSessionTokenFromCookieHeader("foo=bar; baz=qux")).toBeUndefined();
  });

  test("空値 cookie (=以降が空) は undefined (他 helper との一貫性)", () => {
    expect(extractSessionTokenFromCookieHeader(`${SESSION}=`)).toBeUndefined();
    expect(extractSessionTokenFromCookieHeader(`foo=bar; ${SESSION}=  ; baz=qux`)).toBeUndefined();
  });

  test("値の前後の空白を trim する", () => {
    expect(extractSessionTokenFromCookieHeader(`${SESSION}=  spaced  `)).toBe("spaced");
  });

  test("値に '=' が含まれていても全体を返す (split ではなく indexOf で 1 回区切り)", () => {
    expect(extractSessionTokenFromCookieHeader(`${SESSION}=tok=abc=def`)).toBe("tok=abc=def");
  });
});

describe("session cookie 契約の SDK 側", () => {
  const SIGNED = `tok-abc.${"A".repeat(20)}+/${"B".repeat(21)}=`;

  test("build → extract の往復で + / = を含む raw 値がそのまま戻る", () => {
    expect(extractSessionTokenFromCookieHeader(buildSessionCookieHeader(SIGNED))).toBe(SIGNED);
  });

  test("試験で送る header は __Secure- の付いた名前だけを持つ", () => {
    expect(buildSessionCookieHeader("tok")).toBe(`${SESSION}=tok`);
  });

  test("percent-encoded な値を decode しない", () => {
    expect(extractSessionTokenFromCookieHeader(`${SESSION}=abc%2Bdef%3D`)).toBe("abc%2Bdef%3D");
  });

  test("session cookie の名前は export されない (ADR-0006)", async () => {
    const keys = Object.keys(await import("../index"));
    expect(keys).toContain("getSessionToken");
    expect(keys).not.toContain("SESSION_COOKIE_NAME");
  });
});
