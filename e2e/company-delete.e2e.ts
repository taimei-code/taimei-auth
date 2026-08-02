import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

// delete ユーザーは本テストがアカウントごと消費する (消費型 fixture)
test.beforeEach(() => reseedFixture("delete"));

// 最後の事業所削除はアカウント連動削除 (ADR-0010 D3) になり、削除後はログイン画面へ着地する。
// 着地先が params 無しの素の /auth だと SignIn の必須検証 (signInParamsSchema) に落ちて
// invalid_redirect_url エラー画面が出る退行を、ログインフォームの表示まで確認して固定する。

test("最後の事業所削除はアカウントごと削除され、ログイン画面に着地する", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-delete@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/company-settings");
  await page.getByRole("button", { name: "削除する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("これは最後の所属事業所です")).toBeVisible();
  await dialog.getByRole("button", { name: "削除する" }).click();

  await expectSignInLanding(page);
});
