import { describe, expect, test } from "bun:test";
import { auth } from "../../auth";
import { PRIMARY_AUTH_ROUTES } from "../primary-auth-routes";

type RouteMatcher = (ctx: { path: string }) => boolean;
type RegisteredPlugin = {
  id: string;
  hooks?: {
    before?: { matcher: RouteMatcher }[];
    after?: { matcher: RouteMatcher }[];
  };
};

function mfaChallengePlugin(): RegisteredPlugin {
  const plugins = (auth.options.plugins ?? []) as unknown as RegisteredPlugin[];
  const plugin = plugins.find((p) => p.id === "mfa-challenge");
  if (!plugin) throw new Error("mfa-challenge plugin is not registered");
  return plugin;
}

const challengeMatcher = (): RouteMatcher => {
  const matcher = mfaChallengePlugin().hooks?.after?.[0]?.matcher;
  if (!matcher) throw new Error("mfa-challenge after-hook matcher is not registered");
  return matcher;
};

const registeredRoutePaths = (): string[] =>
  Object.values(auth.api as unknown as Record<string, { path?: string }>)
    .map((endpoint) => endpoint?.path)
    .filter((path): path is string => typeof path === "string")
    .sort();

// better-auth 1.6.23 (twoFactor プラグイン無し) が登録する全 route。version 上げで増減したら、増えた route が一次認証の
// セッション発行経路かを分類し直すこと (allowlist の網羅性はこの pin が唯一の検知点)。
const EXPECTED_ROUTE_CATALOG = [
  "/account-info",
  "/callback/:id",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/error",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/magic-link/verify",
  "/ok",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-in/magic-link",
  "/sign-in/social",
  "/sign-out",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

describe("MFA チャレンジ介入点の allowlist", () => {
  test("QA-M-08 登録 route カタログが pin と一致する (未分類の新 route 0 件)", () => {
    expect(registeredRoutePaths()).toEqual(EXPECTED_ROUTE_CATALOG);
  });

  test("QA-M-08 after-hook が一致するのは一次認証 2 route だけ (対象外 0 件)", () => {
    const matcher = challengeMatcher();
    const matched = registeredRoutePaths().filter((path) => matcher({ path }));

    expect(matched.sort()).toEqual([...PRIMARY_AUTH_ROUTES].sort());
  });

  test("QA-M-08 ctx.path は route パターンのため /callback/:id で一致し /callback/github では一致しない", () => {
    const matcher = challengeMatcher();

    expect(matcher({ path: "/callback/:id" })).toBe(true);
    expect(matcher({ path: "/callback/github" })).toBe(false);
    expect(matcher({ path: "/magic-link/verify" })).toBe(true);
  });

  test("QA-M-08 第二要素でセッションを発行する /two-factor/* route が 1 本も存在しない (plugin 撤去の証跡)", () => {
    const twoFactorRoutes = registeredRoutePaths().filter((path) =>
      path.startsWith("/two-factor/"),
    );
    expect(twoFactorRoutes).toEqual([]);
  });
});
