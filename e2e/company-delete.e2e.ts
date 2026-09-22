import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

test("最後の事業所削除はアカウントごと削除され、ログイン画面に着地する", async ({ page }) => {
  reseedFixture("delete");
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

const DELETED_COMPANY = "e2e-co-delete-multi-current";

test("所属が残る事業所削除は一覧へ遷移し、遷移先で成功トーストが出る", async ({ page }) => {
  reseedFixture("delete-multi");
  await signInWithMagicLink(page, "e2e-delete-multi@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/company-settings");
  await expect(page.getByLabel("事業所名")).toHaveValue(DELETED_COMPANY);

  await page.getByRole("button", { name: "削除する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "削除する" }).click();

  await expect(page).toHaveURL(/\/account\/companies/);
  // toast は context 再取得後に出るため、下の一覧 assertion の同期点を兼ねる (順序を変えない)
  await expect(page.getByText(`「${DELETED_COMPANY}」を削除しました。`)).toBeVisible();

  // toast は main の外にあり事業所名を含むため main に絞る
  const main = page.getByRole("main");
  await expect(main.getByText("e2e-co-delete-multi-other")).toBeVisible();
  await expect(main.getByText(DELETED_COMPANY)).toHaveCount(0);
});
