import { expect, test } from "@playwright/test";
import { declaredFailure, routeEndpoint } from "./contract-mock";
import { reseedFixture, signInWithMagicLink, SWITCH_EMAIL } from "./helpers";

test("Foldkit のアカウント管理画面で、セッションの一覧を出す", async ({ page }) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);

  await page.goto("/account/sessions");

  await expect(page.getByRole("heading", { name: "セッション" })).toBeVisible();
  await expect(page.getByText(/^IP: /).first()).toBeVisible();
});

test("Foldkit のアカウント管理画面の nav は、document を読み直さずに画面を替える", async ({
  page,
}) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/security");
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  await page.getByRole("link", { name: "セッション" }).click();

  await expect(page).toHaveURL(/\/account\/sessions$/);
  await expect(page.getByRole("heading", { name: "セッション" })).toBeVisible();
  await expect(page.getByRole("link", { name: "セッション" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(documentRequests).toBe(0);
});

test("Foldkit の Command の SPA の API が Unauthorized を返すと、今の画面を戻り先にして共通ログイン画面へ移る", async ({
  page,
}) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await routeEndpoint(
    page,
    "account.memberships",
    (route) => route.fulfill(declaredFailure("account.memberships", "Unauthorized")),
    { times: 1 },
  );

  const leaving = page.waitForRequest((request) => {
    if (!request.isNavigationRequest()) return false;
    const url = new URL(request.url());
    return (
      url.pathname === "/auth/" &&
      new URL(url.searchParams.get("redirect_url") ?? "", url.origin).pathname ===
        "/account/sessions"
    );
  });
  await page.goto("/account/sessions");

  await leaving;
});
