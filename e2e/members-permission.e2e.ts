import { expect, test } from "@playwright/test";
import { signInWithMagicLink } from "./helpers";

test("MEMBER role には /account/members で役割変更・削除・招待の管理操作が表示されない", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-member@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText("E2E SignIn")).toBeVisible();
  await expect(list.getByText("(自分)")).toBeVisible();

  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "削除" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "メンバーを招待" })).toHaveCount(0);
});

test("OWNER role には管理操作が表示される (出し分けの対照)", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  await expect(page.getByRole("region", { name: "メンバーを招待" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "e2e-member@example.com の役割" })).toBeVisible();
});

test("ADMIN role は OWNER を操作できない (役割 select・削除ボタン・オーナー昇格が出ない)", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-admin@example.com");
  await page.goto("/account/members");
  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();

  await expect(page.getByRole("region", { name: "メンバーを招待" })).toBeVisible();
  const memberRoleSelect = page.getByRole("combobox", { name: "e2e-member@example.com の役割" });
  await expect(memberRoleSelect).toBeVisible();

  await expect(memberRoleSelect.getByRole("option", { name: "オーナー" })).toHaveCount(0);

  // toHaveCount(1) を外すと、行が取れていなくても下の toHaveCount(0) が通る
  const list = page.getByRole("region", { name: "メンバー一覧" });
  const ownerRow = list.getByRole("listitem").filter({ hasText: "e2e-signin@example.com" });
  await expect(ownerRow).toHaveCount(1);
  await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
  await expect(ownerRow.getByRole("button", { name: "削除" })).toHaveCount(0);

  const memberRow = list.getByRole("listitem").filter({ hasText: "e2e-member@example.com" });
  await expect(memberRow.getByRole("button", { name: "削除" })).toBeVisible();
});
