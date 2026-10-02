import { test, expect, describe } from "bun:test";
import { buildAuthLoginUrl } from "../url-builder";

describe("buildAuthLoginUrl", () => {
  test("必須引数: authBaseUrl + service + returnTo", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.taimei-code.com",
      service: "taimei",
      returnTo: "https://app.taimei-code.com/dashboard",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://auth.taimei-code.com");
    expect(parsed.pathname).toBe("/auth/");
    expect(parsed.searchParams.get("service_name")).toBe("taimei");
    expect(parsed.searchParams.get("redirect_url")).toBe("https://app.taimei-code.com/dashboard");
  });

  test("authBaseUrl 末尾スラッシュは正規化される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.taimei-code.com/",
      service: "taimei",
      returnTo: "https://app.taimei-code.com/",
    });
    expect(new URL(url).pathname).toBe("/auth/");
  });

  test("signUpUrl 指定時は sign_up_url クエリが付与される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.taimei-code.com",
      service: "taimei",
      returnTo: "https://app.taimei-code.com/",
      signUpUrl: "https://app.taimei-code.com/welcome",
    });
    expect(new URL(url).searchParams.get("sign_up_url")).toBe(
      "https://app.taimei-code.com/welcome",
    );
  });

  test("signUpUrl 未指定時は sign_up_url クエリが付かない", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.taimei-code.com",
      service: "taimei",
      returnTo: "https://app.taimei-code.com/",
    });
    expect(new URL(url).searchParams.has("sign_up_url")).toBe(false);
  });

  test("hash 指定時は URL fragment に反映される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.taimei-code.com",
      service: "taimei",
      returnTo: "https://app.taimei-code.com/",
      hash: "magic-link",
    });
    expect(new URL(url).hash).toBe("#magic-link");
  });
});
