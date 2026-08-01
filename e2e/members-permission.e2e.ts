import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

// 役割別 UI の出し分けは web/ 層にしかロジックが無く route 統合では検証できない。
// API 側の 403 は既存の membership policy / guard テストが固定済みのため、ここは UI のみ。

test("MEMBER role には /account/members で役割変更・削除・招待の管理操作が表示されない", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-member@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  // メンバー一覧には OWNER (E2E SignIn) と自分が表示される
  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText("E2E SignIn")).toBeVisible();
  await expect(list.getByText("(自分)")).toBeVisible();

  // 管理操作: 役割変更 select / 削除ボタン / 招待フォームのいずれも出ない
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "メンバーを招待" })).toHaveCount(0);
});

test("OWNER role には管理操作が表示される (出し分けの対照)", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  await expect(page.getByRole("region", { name: "メンバーを招待" })).toBeVisible();
  // 自分以外 (E2E Member) の行には役割変更 select が出る (件数はメンバー構成に依存させない)
  await expect(page.getByRole("combobox", { name: "e2e-member@example.com の役割" })).toBeVisible();
});
