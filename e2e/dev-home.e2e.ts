import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "./helpers";

const OWNER = { id: "dev-account-owner", email: "dev-owner@example.com" };
const ADMIN_EMAIL = "dev-admin@example.com";
const SAME_SITE_OTHER_ORIGIN = "http://localhost:3999";

const signedInSection = (page: Page) => page.getByRole("region", { name: "ログイン中の利用者" });

const chooseOnDevHome = async (page: Page, email: string) => {
  await page.getByRole("button", { name: new RegExp(email) }).click();
  await expect(page).toHaveURL(`${BASE_URL}${DEV_HOME_PATH}`);
  await expect(signedInSection(page)).toContainText(email);
};

const expectForbiddenFromOtherOrigin = async (page: Page, path: string, userId?: string) => {
  const input =
    userId === undefined ? "" : `<input type="hidden" name="userId" value="${userId}" />`;
  await page.route(`${SAME_SITE_OTHER_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<form method="post" action="${BASE_URL}${path}">${input}</form><script>document.forms[0].submit()</script>`,
    }),
  );
  const responded = page.waitForResponse(`${BASE_URL}${path}`);
  await page.goto(`${SAME_SITE_OTHER_ORIGIN}/`);
  const response = await responded;

  expect(response.status()).toBe(403);
  expect(await response.text()).toBe('{"_tag":"Forbidden"}');
};

test("開発者ホームで、利用者を選んでログインし、ログイン中の利用者を確かめ、別の利用者に切り替え、ログアウトできる", async ({
  page,
}) => {
  await page.goto(DEV_HOME_PATH);
  await expect(signedInSection(page)).toContainText("ログインしていません");

  await chooseOnDevHome(page, OWNER.email);
  await chooseOnDevHome(page, ADMIN_EMAIL);

  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(signedInSection(page)).toContainText("ログインしていません");
});

test("auth ホストと same-site の別の origin の page が自動で送る、利用者を選ぶ form は 403 になり、ログインしない", async ({
  page,
}) => {
  await expectForbiddenFromOtherOrigin(page, `${DEV_HOME_PATH}/sign-in`, OWNER.id);

  await page.goto(DEV_HOME_PATH);
  await expect(signedInSection(page)).toContainText("ログインしていません");
});

test("ログイン中に、auth ホストと same-site の別の origin の page が自動で送るログアウトの form は、session の cookie が届いても 403 になり、ログインしたままである", async ({
  page,
}) => {
  await page.goto(DEV_HOME_PATH);
  await chooseOnDevHome(page, OWNER.email);

  await expectForbiddenFromOtherOrigin(page, `${DEV_HOME_PATH}/sign-out`);

  await page.goto(DEV_HOME_PATH);
  await expect(signedInSection(page)).toContainText(OWNER.email);
});
