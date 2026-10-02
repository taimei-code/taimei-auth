import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

test("唯一の OWNER の退会は中断され、エラーが表示されて /account に留まる", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "所有者として残っている事業所があります。先に委譲または削除してください。",
  );

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});

test("共同 OWNER がいれば退会でき、ログイン画面へ移り session が消える", async ({ page }) => {
  reseedFixture("withdraw");
  await signInWithMagicLink(page, "e2e-withdraw@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  await expectSignInLanding(page);
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.includes("session"))).toEqual([]);
});
