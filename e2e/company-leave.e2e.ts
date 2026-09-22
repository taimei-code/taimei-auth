import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

test.beforeEach(() => reseedFixture("leave"));

test("最後の所属事業所から抜けるとアカウントごと削除され、ログイン画面に着地する", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-leaver@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/companies");
  await page.getByRole("button", { name: "抜ける" }).click();

  await expectSignInLanding(page);
});
