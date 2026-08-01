import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

// 唯一の OWNER の退会は auth.ts の beforeDelete (OWNER_OF_ACTIVE_COMPANY) で中断される。
// サーバ側の判定は db の deletion-primitives テストが固定済みのため、ここは
// 「中断がエラー表示として user に見え、session が生き残る」SPA 側の動線を固定する。

test("唯一の OWNER の退会は中断され、エラーが表示されて /account に留まる", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  // エラー時は dialog が自動で閉じ、エラー文言が見える状態になる
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();

  // 退会は成立しておらず、リロードしても認証済みのまま /account に入れる
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});
