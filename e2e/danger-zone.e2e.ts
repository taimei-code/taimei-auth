import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

test("唯一の OWNER の退会は中断され、エラーが表示されて /account に留まる", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});
