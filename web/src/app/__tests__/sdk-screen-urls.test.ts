import { describe, expect, test } from "bun:test";
import {
  AUTH_ERROR_REASONS,
  buildAccountUrl,
  buildAuthErrorUrl,
  buildAuthLoginUrl,
  buildCompanySignupUrl,
  buildMembersUrl,
} from "@taimei-code/auth-client";
import { Option } from "effect";
import { fromString } from "foldkit/url";

import { redirectTargetSearchSchema } from "@core/invitation/accept-path";

import { AccountRoute, urlToAccountRoute } from "../account/route";
import { AuthRoute, urlToAuthRoute } from "../auth/route";
import { runtimeForPath } from "../runtime-for-path";

const authBaseUrl = "https://auth.taimei-code.com";
const fromTaimei = {
  authBaseUrl,
  service: "taimei",
  returnTo: "https://app.taimei-code.com/",
};

const searchOf = (url: string) => Object.fromEntries(new URL(url).searchParams);

const authRouteOf = (url: string) =>
  Option.match(fromString(url), {
    onNone: () => AuthRoute.NotFound({ path: url }),
    onSome: urlToAuthRoute,
  });

const accountRouteTagOf = (url: string) =>
  Option.match(fromString(url), {
    onNone: () => "NotFound",
    onSome: (parsed) => urlToAccountRoute(parsed)._tag,
  });

describe("auth-client が組むアカウント管理画面の URL は、Foldkit の application の route に当たる", () => {
  test.each([
    ["メンバー画面", buildMembersUrl(fromTaimei), AccountRoute.Members()._tag],
    [
      "アカウント管理画面 (/account の下の最初の画面)",
      buildAccountUrl({ authBaseUrl }),
      AccountRoute.Profile()._tag,
    ],
  ] as const)("%s", (_, url, routeTag) => {
    expect(runtimeForPath(new URL(url).pathname)).toBe("FoldkitAccount");
    expect(accountRouteTagOf(url)).toBe(routeTag);
  });
});

test.each([
  "/auth/error/",
  "/auth/error//",
])("末尾に / の付いたエラー画面の path %s も、Foldkit の application が描く", (pathname) => {
  expect(runtimeForPath(pathname)).toBe("FoldkitAuth");
});

test("auth-client が組む共通ログイン画面の URL は、Foldkit の application が描く", () => {
  expect(runtimeForPath(new URL(buildAuthLoginUrl(fromTaimei)).pathname)).toBe("FoldkitAuth");
});

test("auth-client が組む事業所作成画面の URL は、Foldkit の application が描く", () => {
  expect(runtimeForPath(new URL(buildCompanySignupUrl(fromTaimei)).pathname)).toBe("FoldkitAuth");
});

test("auth-client が組むエラー画面の URL は、Foldkit の application が描く", () => {
  expect(
    runtimeForPath(new URL(buildAuthErrorUrl({ authBaseUrl, reason: "signin_failed" })).pathname),
  ).toBe("FoldkitAuth");
});

describe("auth-client が組む画面の URL の query は、その画面の search の schema で読める", () => {
  test.each([...AUTH_ERROR_REASONS])("エラー画面は理由 %s をそのまま読む", (reason) => {
    expect(authRouteOf(buildAuthErrorUrl({ authBaseUrl, reason }))).toEqual(
      AuthRoute.Error({ reason: Option.some(reason) }),
    );
  });

  test("エラー画面は共通画面 SPA の内部の理由も読む", () => {
    expect(authRouteOf(`${authBaseUrl}/auth/error?reason=invalid_redirect_url`)).toEqual(
      AuthRoute.Error({ reason: Option.some("invalid_redirect_url") }),
    );
  });

  test("エラー画面は定義外の理由を、理由なしとして読む", () => {
    expect(authRouteOf(`${authBaseUrl}/auth/error?reason=bogus`)).toEqual(
      AuthRoute.Error({ reason: Option.none() }),
    );
  });

  test("共通ログイン画面は service_name と redirect_url を Foldkit の route に読む", () => {
    expect(authRouteOf(buildAuthLoginUrl(fromTaimei))).toEqual(
      AuthRoute.SignIn({ service_name: "taimei", redirect_url: fromTaimei.returnTo }),
    );
  });

  test("事業所作成画面は service_name と redirect_url を Foldkit の route に読む", () => {
    expect(authRouteOf(buildCompanySignupUrl(fromTaimei))).toEqual(
      AuthRoute.SignUpCompany({ service_name: "taimei", redirect_url: fromTaimei.returnTo }),
    );
  });

  test("メンバー画面は service_name と redirect_url を読む", () => {
    expect(redirectTargetSearchSchema.parse(searchOf(buildMembersUrl(fromTaimei)))).toEqual({
      service_name: "taimei",
      redirect_url: fromTaimei.returnTo,
    });
  });
});
