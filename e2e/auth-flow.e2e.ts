import { expect, test } from "@playwright/test";
import { magicLinkFor, signInWithMagicLink } from "./helpers";

test("既存 user の magic link sign-in は /account に到達し、ログアウトで sign-in 画面へ戻る", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();

  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});

test("新規 user の sign-up は事業所登録に誘導され、作成後に /account へ到達する", async ({
  page,
}) => {
  const email = `e2e-newbie-${Date.now()}@example.com`;

  await signInWithMagicLink(page, email);

  await expect(page.getByText("事業所を登録してください")).toBeVisible();

  await page.getByLabel("事業所名").fill(`e2e-co-newbie-${Date.now()}`);
  await page.getByRole("button", { name: "事業所を作成" }).click();

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});

test("使用済み magic link の再クリックでは session を得られない", async ({ page, context }) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await expect(page).toHaveURL(/\/account/);
  const usedLink = await magicLinkFor("e2e-signin@example.com");

  await context.clearCookies();
  await page.goto(usedLink);

  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});
