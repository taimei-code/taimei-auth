import { expect, type Page, test } from "@playwright/test";
import { BASE_URL, reseedFixture, signInWithMagicLink, SWITCH_EMAIL } from "./helpers";

const MEMBERS_URL = `${BASE_URL}/account/members`;
const MEMBERS_URL_FROM_CONSUMER = `${MEMBERS_URL}?service_name=accounts`;
const PROFILE_URL = `${BASE_URL}/account`;

const expectOpenDialogHoldsScrollLock = async (page: Page) => {
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
};

const goBackToAnotherPageWithDialogOpen = async (page: Page) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(PROFILE_URL);
  await page.getByRole("link", { name: "メンバー" }).click();
  await expect(page).toHaveURL(MEMBERS_URL);
  await page.getByRole("link", { name: "プロフィール" }).click();
  await expect(page).toHaveURL(PROFILE_URL);

  await page.getByRole("button", { name: "退会する" }).click();
  await expectOpenDialogHoldsScrollLock(page);

  await page.goBack();
  await expect(page).toHaveURL(MEMBERS_URL);
  await expect(page.getByRole("region", { name: "メンバー一覧" })).toBeVisible();
};

const goBackToSameKindOfPageWithDialogOpen = async (page: Page) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto(MEMBERS_URL_FROM_CONSUMER);
  await expect(page.getByRole("region", { name: "メンバー一覧" })).toBeVisible();
  await page.getByRole("link", { name: "メンバー" }).click();
  await expect(page).toHaveURL(MEMBERS_URL);

  await page
    .getByRole("region", { name: "メンバー一覧" })
    .getByRole("button", { name: "削除" })
    .first()
    .click();
  await expectOpenDialogHoldsScrollLock(page);

  await page.goBack();
  await expect(page).toHaveURL(MEMBERS_URL_FROM_CONSUMER);
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

test("dialog を開いたまま「戻る」で別の page へ移ると、<html> に overflow: hidden が残らない", async ({
  page,
}) => {
  await goBackToAnotherPageWithDialogOpen(page);

  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
});

test("dialog を開いたまま「戻る」で別の page へ移ると、Tab で focus が次の link へ動く", async ({
  page,
}) => {
  await goBackToAnotherPageWithDialogOpen(page);

  await page.getByRole("link", { name: "所属事業所" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "メンバー" })).toBeFocused();
});

test("dialog を開いたまま「戻る」で同じ種類の page を入れ直すと、<html> に overflow: hidden が残らない", async ({
  page,
}) => {
  await goBackToSameKindOfPageWithDialogOpen(page);

  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
});

test("dialog を開いたまま「戻る」で同じ種類の page を入れ直すと、sidebar の link で別の page へ移れる", async ({
  page,
}) => {
  await goBackToSameKindOfPageWithDialogOpen(page);

  await page.getByRole("link", { name: "プロフィール" }).click();
  await expect(page).toHaveURL(PROFILE_URL);
});
