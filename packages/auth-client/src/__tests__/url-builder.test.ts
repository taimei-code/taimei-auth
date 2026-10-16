import { test, expect, describe } from "bun:test";
import { buildAuthLoginUrl } from "../url-builder";

describe("buildAuthLoginUrl", () => {
  test("必須引数: authBaseUrl + service + returnTo", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.example",
      service: "example-service",
      returnTo: "https://app.example/",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://auth.example");
    expect(parsed.pathname).toBe("/auth/");
    expect(parsed.searchParams.get("service_name")).toBe("example-service");
    expect(parsed.searchParams.get("redirect_url")).toBe("https://app.example/");
  });

  test("authBaseUrl 末尾スラッシュは正規化される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.example/",
      service: "example-service",
      returnTo: "https://app.example/",
    });
    expect(new URL(url).pathname).toBe("/auth/");
  });

  test("signUpUrl 指定時は sign_up_url クエリが付与される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.example",
      service: "example-service",
      returnTo: "https://app.example/",
      signUpUrl: "https://app.example/welcome",
    });
    expect(new URL(url).searchParams.get("sign_up_url")).toBe("https://app.example/welcome");
  });

  test("signUpUrl 未指定時は sign_up_url クエリが付かない", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.example",
      service: "example-service",
      returnTo: "https://app.example/",
    });
    expect(new URL(url).searchParams.has("sign_up_url")).toBe(false);
  });

  test("hash 指定時は URL fragment に反映される", () => {
    const url = buildAuthLoginUrl({
      authBaseUrl: "https://auth.example",
      service: "example-service",
      returnTo: "https://app.example/",
      hash: "magic-link",
    });
    expect(new URL(url).hash).toBe("#magic-link");
  });
});
