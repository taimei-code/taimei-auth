import { expect, test } from "@playwright/test";
import { magicLinkFor, signInWithMagicLink } from "./helpers";

// 認証動線のブラウザ実機スモーク。route 統合テストでは検証できない
// 「magic link 着地 → SessionGuard → 画面遷移」の連鎖 (#74 redirect loop の再発面) を固定する。

test("既存 user の magic link sign-in は /account に到達し、ログアウトで sign-in 画面へ戻る", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();

  // signOut 後は "/" へ遷移し、login-shortcut が未認証を検知して /auth/ に 302 する
  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});

test("新規 user の sign-up は事業所登録に誘導され、作成後に /account へ到達する", async ({
  page,
}) => {
  // 再実行時に「既存 user」へ化けないよう毎回一意の email を使う (掃除は次回 seed が行う)
  const email = `e2e-newbie-${Date.now()}@example.com`;

  await signInWithMagicLink(page, email);

  // membership 0 件のため SessionGuard が事業所登録ページへ誘導する
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

  // 別デバイス相当の cookie 無しコンテキストで同じ link を踏む
  await context.clearCookies();
  await page.goto(usedLink);

  // single-use のため error=INVALID_TOKEN で戻され、未認証のまま sign-in 画面へ redirect される
  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});
