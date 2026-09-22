import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

// 役割別の UI の出し分けは web/ 層にしかロジックが無く、route の統合テストでは検証できない。
// API 側の 403 は既存の membership policy と guard のテストで固定済みのため、ここでは UI だけを見る。

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

  // 管理操作である役割変更の select、削除ボタン、招待フォームのいずれも出ない
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "メンバーを招待" })).toHaveCount(0);
});

test("OWNER role には管理操作が表示される (出し分けの対照)", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  await expect(page.getByRole("region", { name: "メンバーを招待" })).toBeVisible();
  // 自分以外 (E2E Member) の行には役割変更の select が出る (件数はメンバー構成に依存させない)
  await expect(page.getByRole("combobox", { name: "e2e-member@example.com の役割" })).toBeVisible();
});

test("ADMIN role は OWNER を操作できない (役割 select・削除ボタン・オーナー昇格が出ない)", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-admin@example.com");
  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  // ADMIN も招待と、OWNER 以外の役割変更はできる
  await expect(page.getByRole("region", { name: "メンバーを招待" })).toBeVisible();
  const memberRoleSelect = page.getByRole("combobox", { name: "e2e-member@example.com の役割" });
  await expect(memberRoleSelect).toBeVisible();

  // OWNER へ昇格させる選択肢は OWNER にしか出ない
  await expect(memberRoleSelect.getByRole("option", { name: "オーナー" })).toHaveCount(0);

  // OWNER (E2E SignIn) の行は操作できない。役割の select が無く、削除ボタンも出ない。
  // toHaveCount(1) による行の存在確認は残す。空の locator は toHaveCount(0) 系の assertion を
  // 通してしまう (行が取れていないだけでも緑になる) ためである。
  const list = page.getByRole("region", { name: "メンバー一覧" });
  const ownerRow = list.getByRole("listitem").filter({ hasText: "e2e-signin@example.com" });
  await expect(ownerRow).toHaveCount(1);
  await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
  await expect(ownerRow.getByRole("button", { name: "削除" })).toHaveCount(0);

  // 対照として、OWNER 以外 (E2E Member) の行には削除ボタンが出る
  const memberRow = list.getByRole("listitem").filter({ hasText: "e2e-member@example.com" });
  await expect(memberRow.getByRole("button", { name: "削除" })).toBeVisible();
});
