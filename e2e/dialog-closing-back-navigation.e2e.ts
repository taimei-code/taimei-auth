import { expect, type Page, test } from "@playwright/test";
import {
  BASE_URL,
  companySwitcher,
  reseedFixture,
  signInWithMagicLink,
  SWITCH_EMAIL,
} from "./helpers";

const PROFILE_URL = `${BASE_URL}/account`;
const DELETED_COMPANY = "e2e-co-delete-multi-current";
const REMAINING_COMPANY = "e2e-co-delete-multi-other";
const ADDED_COMPANY = "e2e-co-switch-added";
const CLOSE_ANIMATION_OUTLASTS_THE_TEST =
  "dialog [data-leave] { transition-duration: 30s !important; }";

const frame = (page: Page) => page.getByRole("complementary");

const enterFromProfile = async (page: Page, email: string, sidebarLink: string) => {
  await signInWithMagicLink(page, email);
  await expect(page).toHaveURL(PROFILE_URL);
  await page.getByRole("link", { name: sidebarLink }).click();
  await page.addStyleTag({ content: CLOSE_ANIMATION_OUTLASTS_THE_TEST });
};

const goBackToProfileWhileDialogIsClosing = async (page: Page) => {
  await expect(page.locator("dialog [data-leave]").first()).toBeAttached();
  await page.goBack();
  await expect(page).toHaveURL(PROFILE_URL);
};

test("事業所の削除が成功して dialog が閉じる animation の間に「戻る」で別の page へ移ると、枠の現在の事業所が残った事業所になる", async ({
  page,
}) => {
  reseedFixture("delete-multi");
  await enterFromProfile(page, "e2e-delete-multi@example.com", "事業所設定");
  await expect(page.getByLabel("事業所名")).toHaveValue(DELETED_COMPANY);

  await page.getByRole("button", { name: "削除する" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除する" }).click();
  await goBackToProfileWhileDialogIsClosing(page);

  await expect(frame(page).getByText(REMAINING_COMPANY)).toBeVisible();
  await expect(frame(page).getByText(DELETED_COMPANY)).toHaveCount(0);
});

test("事業所の追加が成功して dialog が閉じる animation の間に「戻る」で別の page へ移ると、枠の現在の事業所が追加した事業所になる", async ({
  page,
}) => {
  reseedFixture("switch");
  await enterFromProfile(page, SWITCH_EMAIL, "所属事業所");

  await page.getByRole("button", { name: "事業所を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事業所名").fill(ADDED_COMPANY);
  await dialog.getByRole("button", { name: "作成する" }).click();
  await goBackToProfileWhileDialogIsClosing(page);

  await expect(companySwitcher(page).locator("option:checked")).toHaveText(ADDED_COMPANY);
});

test("オーナーの委譲が成功して dialog が閉じる animation の間に「戻る」で別の page へ移ると、枠の役割が管理者になる", async ({
  page,
}) => {
  reseedFixture("switch");
  await enterFromProfile(page, SWITCH_EMAIL, "所属事業所");
  await expect(frame(page).getByText(/・ オーナー$/)).toBeVisible();

  const soleOwnerCompany = page
    .getByRole("main")
    .locator("div.rounded-md.border")
    .filter({ hasText: "e2e-co-switch-a" });
  await soleOwnerCompany.getByRole("button", { name: "抜ける" }).click();
  await soleOwnerCompany.getByRole("button", { name: "オーナーを委譲" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("E2E SwitchAMate")).toBeVisible();
  await dialog.getByRole("button", { name: "委譲" }).click();
  await goBackToProfileWhileDialogIsClosing(page);

  await expect(frame(page).getByText(/・ 管理者$/)).toBeVisible();
});
