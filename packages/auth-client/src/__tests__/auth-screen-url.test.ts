import { test, expect, describe } from "bun:test";
import {
  AUTH_ERROR_REASONS,
  buildAccountUrl,
  buildAuthErrorUrl,
  buildCompanySignupUrl,
  buildMembersUrl,
} from "../index";
import { buildDevHomeUrl } from "../testing";

describe("buildAuthErrorUrl", () => {
  test.each([
    ...AUTH_ERROR_REASONS,
  ])("エラー画面の URL に理由 %s だけを query で付ける", (reason) => {
    const url = new URL(buildAuthErrorUrl({ authBaseUrl: "https://auth.example", reason }));
    expect(url.origin).toBe("https://auth.example");
    expect(url.pathname).toBe("/auth/error");
    expect([...url.searchParams.keys()]).toEqual(["reason"]);
    expect(url.searchParams.get("reason")).toBe(reason);
  });

  test("consumer は共通画面 SPA の内部の理由をエラー画面へ渡せない (型の probe は typecheck で機能する)", () => {
    const _internalReason = () =>
      // @ts-expect-error invalid_redirect_url は consumer が送る理由ではない
      buildAuthErrorUrl({ authBaseUrl: "https://auth.example", reason: "invalid_redirect_url" });
    expect(_internalReason).toBeFunction();
  });

  test("consumer が送れる理由はログインの失敗と登録済みの 2 つ", () => {
    expect(AUTH_ERROR_REASONS).toEqual(["signin_failed", "signup_already_completed"]);
  });
});

const screenOptions = {
  authBaseUrl: "https://auth.example",
  service: "example-service",
  returnTo: "https://app.example/x",
};

describe("service から移る画面の URL", () => {
  test.each([
    ["事業所作成画面", buildCompanySignupUrl, "/auth/signup/company"],
    ["メンバー画面", buildMembersUrl, "/account/members"],
  ])("%s の URL に service_name と redirect_url だけを付ける", (_, build, pathname) => {
    const url = new URL(build(screenOptions));
    expect(url.pathname).toBe(pathname);
    expect([...url.searchParams.keys()]).toEqual(["service_name", "redirect_url"]);
    expect(url.searchParams.get("service_name")).toBe("example-service");
    expect(url.searchParams.get("redirect_url")).toBe("https://app.example/x");
  });
});

describe("buildAccountUrl", () => {
  test("アカウント管理画面の URL は query を付けない", () => {
    expect(buildAccountUrl({ authBaseUrl: "https://auth.example" })).toBe(
      "https://auth.example/account",
    );
  });
});

describe("auth ホストの画面の URL は authBaseUrl の末尾の / に左右されない", () => {
  test.each([
    [
      "buildAuthErrorUrl",
      (authBaseUrl: string) => buildAuthErrorUrl({ authBaseUrl, reason: "signin_failed" }),
    ],
    [
      "buildCompanySignupUrl",
      (authBaseUrl: string) => buildCompanySignupUrl({ ...screenOptions, authBaseUrl }),
    ],
    [
      "buildMembersUrl",
      (authBaseUrl: string) => buildMembersUrl({ ...screenOptions, authBaseUrl }),
    ],
    ["buildAccountUrl", (authBaseUrl: string) => buildAccountUrl({ authBaseUrl })],
  ])("%s", (_, build) => {
    expect(build("https://auth.example/")).toBe(build("https://auth.example"));
  });
});

describe("buildDevHomeUrl", () => {
  test("開発者ホームの URL に service_name と redirect_url だけを付ける", () => {
    const url = new URL(buildDevHomeUrl(screenOptions));
    expect(url.origin).toBe("https://auth.example");
    expect(url.pathname).toBe("/dev");
    expect([...url.searchParams.keys()]).toEqual(["service_name", "redirect_url"]);
    expect(url.searchParams.get("service_name")).toBe("example-service");
    expect(url.searchParams.get("redirect_url")).toBe("https://app.example/x");
  });

  test("authBaseUrl の末尾の / に左右されない", () => {
    expect(buildDevHomeUrl({ ...screenOptions, authBaseUrl: "https://auth.example/" })).toBe(
      buildDevHomeUrl(screenOptions),
    );
  });
});
