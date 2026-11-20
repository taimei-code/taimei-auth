import { expect, type Page, test } from "@playwright/test";
import {
  addVirtualAuthenticator,
  featureFlags,
  PASSKEY_EMAIL,
  reseedFixture,
  signInWithMagicLink,
} from "./helpers";

const PASSKEY = "passkey";

const passkeyRow = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByText("パスキー", { exact: true }) });

const registerButton = (page: Page) => passkeyRow(page).getByRole("button", { name: "登録する" });

const openSecurity = async (page: Page) => {
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(passkeyRow(page)).toBeVisible();
};

test.beforeEach(() => reseedFixture("passkey"));

test.afterEach(({ request }) => featureFlags(request).on(PASSKEY));

test("生体か PIN の確認ありの仮想の authenticator で登録すると、一覧に未使用のパスキーが 1 行増える", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await openSecurity(page);
  await expect(passkeyRow(page)).toContainText("登録したパスキーはありません");

  await registerButton(page).click();

  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
  await expect(passkeyRow(page)).toContainText("未使用");
  await expect(page.getByText("パスキーを登録しました。")).toBeVisible();
});

test("確認を拒んで取り消すと、一覧は変わらず、誤りも出ず、続けて登録できる", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page, { userVerified: false });
  await openSecurity(page);

  const options = page.waitForResponse("**/api/account/passkeys/registration-options");
  await registerButton(page).click();
  await options;
  await expect(registerButton(page)).toBeEnabled();
  expect(await page.getByRole("alert").count()).toBe(0);
  expect(await passkeyRow(page).getByRole("listitem").count()).toBe(0);

  await authenticator.verifyUser();
  await registerButton(page).click();
  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
});

test("登録の後でフラグを off にすると、一覧は出るが「登録する」は出ない", async ({ page }) => {
  await addVirtualAuthenticator(page);
  await openSecurity(page);
  await registerButton(page).click();
  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);

  await featureFlags(page.request).off(PASSKEY);
  await page.reload();

  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
  expect(await registerButton(page).count()).toBe(0);
});
