import { describe, expect, test } from "bun:test";
import {
  AUTH_ERROR_REASONS,
  buildAccountUrl,
  buildAuthErrorUrl,
  buildAuthLoginUrl,
  buildCompanySignupUrl,
  buildMembersUrl,
} from "@taimei-code/auth-client";
import { AtomRegistry } from "effect/reactivity";

import { redirectTargetSearchSchema } from "@core/invitation/accept-path";
import { signInParamsSchema } from "@core/sign-in-params";

import { authErrorSearchSchema } from "../../auth/auth-error-reason";
import { makeRouter } from "../router";

const authBaseUrl = "https://auth.taimei-code.com";
const fromTaimei = {
  authBaseUrl,
  service: "taimei",
  returnTo: "https://app.taimei-code.com/",
};

const router = makeRouter(AtomRegistry.make());

const deepestMatchedRouteIdOf = (url: string) =>
  router.matchRoutes(new URL(url).pathname, {}).at(-1)?.routeId;

const searchOf = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("auth-client が組む画面の URL は共通画面 SPA の route に当たる", () => {
  test.each([
    ["共通ログイン画面", buildAuthLoginUrl(fromTaimei), "/auth/"],
    ["エラー画面", buildAuthErrorUrl({ authBaseUrl, reason: "signin_failed" }), "/auth/error"],
    ["事業所作成画面", buildCompanySignupUrl(fromTaimei), "/auth/signup/company"],
    ["メンバー画面", buildMembersUrl(fromTaimei), "/account/members"],
    [
      "アカウント管理画面 (/account の下の最初の画面)",
      buildAccountUrl({ authBaseUrl }),
      "/account/",
    ],
  ] as const)("%s", (_, url, routeId) => {
    expect(deepestMatchedRouteIdOf(url)).toBe(routeId);
  });
});

describe("auth-client が組む画面の URL の query は、その画面の search の schema で読める", () => {
  test.each([...AUTH_ERROR_REASONS])("エラー画面は理由 %s をそのまま読む", (reason) => {
    expect(
      authErrorSearchSchema.parse(searchOf(buildAuthErrorUrl({ authBaseUrl, reason }))).reason,
    ).toBe(reason);
  });

  test("エラー画面は共通画面 SPA の内部の理由も読む", () => {
    expect(authErrorSearchSchema.parse({ reason: "invalid_redirect_url" }).reason).toBe(
      "invalid_redirect_url",
    );
  });

  test.each([
    ["共通ログイン画面", buildAuthLoginUrl(fromTaimei)],
    ["事業所作成画面", buildCompanySignupUrl(fromTaimei)],
  ])("%s は service_name と redirect_url を読む", (_, url) => {
    expect(signInParamsSchema.parse(searchOf(url))).toEqual({
      service_name: "taimei",
      redirect_url: fromTaimei.returnTo,
    });
  });

  test("メンバー画面は service_name と redirect_url を読む", () => {
    expect(redirectTargetSearchSchema.parse(searchOf(buildMembersUrl(fromTaimei)))).toEqual({
      service_name: "taimei",
      redirect_url: fromTaimei.returnTo,
    });
  });
});
