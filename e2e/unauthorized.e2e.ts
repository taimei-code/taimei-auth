import { expect, test } from "@playwright/test";
import { reseedFixture, signInWithMagicLink, SWITCH_EMAIL } from "./helpers";
import { declaredFailure, routeEndpoint } from "./contract-mock";

const signInDocumentReturningTo = (page: import("@playwright/test").Page, path: string) =>
  page.waitForRequest((request) => {
    if (!request.isNavigationRequest()) return false;
    const url = new URL(request.url());
    return (
      url.pathname === "/auth/" &&
      new URL(url.searchParams.get("redirect_url") ?? "", url.origin).pathname === path
    );
  });

test("画面の途中で SPA の API が Unauthorized を返すと、今の画面を戻り先にして共通ログイン画面へ移る", async ({
  page,
}) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await routeEndpoint(
    page,
    "membership.list",
    (route) => route.fulfill(declaredFailure("membership.list", "Unauthorized")),
    { times: 1 },
  );

  const leaving = signInDocumentReturningTo(page, "/account/members");
  await page.goto("/account/members");

  await leaving;
  await expect(page).toHaveURL(/\/account\/members/);
});

test("招待の受諾が Unauthorized を受けると、受諾の失敗の文言を出さずに共通ログイン画面へ移る", async ({
  page,
}) => {
  reseedFixture("invitation");
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await routeEndpoint(
    page,
    "invitation.accept",
    (route) => route.fulfill(declaredFailure("invitation.accept", "Unauthorized")),
    { times: 1 },
  );

  const leaving = signInDocumentReturningTo(page, "/auth/signup/accept-invitation");
  await page.goto("/auth/signup/accept-invitation?invitation_token=e2e-invitation-token");

  await leaving;
  await expect(page.getByText("招待の受諾に失敗しました。")).toHaveCount(0);
});
