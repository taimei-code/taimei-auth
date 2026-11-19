import { describe, expect, test } from "bun:test";
import { betterAuthRoutePaths, routesCreatingMfaChallenge } from "./harness/passkey-sign-in-api";

const ROUTE_CATALOG = [
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

describe("better-auth の route と MFA チャレンジの介入点", () => {
  test("better-auth の route の一覧は変わらない", () => {
    expect(betterAuthRoutePaths()).toEqual(ROUTE_CATALOG);
  });

  test("一次認証の後に MFA チャレンジを作る判定が一致する route は /callback/:id と /magic-link/verify だけのまま", () => {
    expect(routesCreatingMfaChallenge()).toEqual(["/callback/:id", "/magic-link/verify"]);
  });
});
