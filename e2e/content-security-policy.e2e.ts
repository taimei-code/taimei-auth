import { expect, type Page, test } from "@playwright/test";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import {
  authEntryUrl,
  BASE_URL,
  MFA_EMAIL,
  mfaRow,
  reseedFixture,
  signInWithMagicLink,
} from "./helpers";

type Violation = { directive: string; blockedURI: string; disposition: string; source: string };

const collectViolations = async (page: Page) => {
  await page.addInitScript(() => {
    const violations: Violation[] = [];
    Object.assign(window, { __cspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        source: `${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
      });
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);
};

const ACCOUNT_PATHS = [
  "/account/sessions",
  "/account/connections",
  "/account/companies",
  "/account/members",
  "/account/company-settings",
];

test("共通ログイン画面・共通サインアップ画面・エラー画面・開発者ホームは CSP に違反しない", async ({
  page,
}) => {
  const violations = await collectViolations(page);
  for (const url of [
    authEntryUrl(),
    `${BASE_URL}/auth/signup?service_name=accounts&redirect_url=${encodeURIComponent(`${BASE_URL}/account`)}`,
    `${BASE_URL}/auth/error?reason=signin_failed`,
    DEV_HOME_PATH,
  ]) {
    const response = await page.goto(url);
    expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await violations()).toEqual([]);
  }
});

test("アカウント管理画面の各 page と、MFA の QR コードと通知は CSP に違反しない", async ({
  page,
}) => {
  reseedFixture("mfa");
  const violations = await collectViolations(page);
  await signInWithMagicLink(page, MFA_EMAIL);
  for (const path of ACCOUNT_PATHS) {
    const response = await page.goto(`${BASE_URL}${path}`);
    expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(await violations()).toEqual([]);
  }

  await page.goto(`${BASE_URL}/account/security`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  await expect(page.getByRole("img", { name: "認証アプリで読み取る QR コード" })).toBeVisible();
  expect(await violations()).toEqual([]);

  await page.goto(`${BASE_URL}/account`);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(await violations()).toEqual([]);
});
