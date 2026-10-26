import { createTestingClient, DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "./helpers";

const OWNER = { id: "dev-account-owner", email: "dev-owner@example.com" };
const ADMIN_EMAIL = "dev-admin@example.com";
const SAME_SITE_OTHER_ORIGIN = "http://localhost:3999";

const signedInSection = (page: Page) => page.getByRole("region", { name: "ログイン中の利用者" });

const accountList = (page: Page) => page.getByRole("region", { name: "ログインする利用者を選ぶ" });

const accountButton = (page: Page, email: string) =>
  accountList(page).getByRole("button", { name: email, exact: true });

const accountFilter = (page: Page) => page.getByLabel("利用者を絞り込む");

const signedInEmail = (page: Page, email: string) =>
  signedInSection(page).getByText(email, { exact: true });

const chooseOnDevHome = async (page: Page, email: string) => {
  await accountButton(page, email).click();
  await expect(signedInEmail(page, email)).toBeVisible();
  await expect(page).toHaveURL(`${BASE_URL}${DEV_HOME_PATH}`);
};

const signInAsNewUserInThisBrowser = async (page: Page) => {
  const { email, loginUrl } = await createTestingClient(BASE_URL).createSignedInUser({
    companies: [{ role: "OWNER" }],
    returnTo: `${BASE_URL}${DEV_HOME_PATH}`,
  });
  await page.goto(loginUrl);
  await expect(signedInEmail(page, email)).toBeVisible();
  return email;
};

const signOutOnDevHome = async (page: Page) => {
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(signedInSection(page)).toContainText("ログインしていません");
};

const TRANSPARENT = "rgba(0, 0, 0, 0)";

const focusIsVisible = (page: Page) =>
  page.evaluate((transparent) => {
    if (!document.activeElement) return false;
    const style = getComputedStyle(document.activeElement);
    const outlineIsVisible = style.outlineStyle !== "none" && style.outlineColor !== transparent;
    return outlineIsVisible || style.boxShadow !== "none";
  }, TRANSPARENT);

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

  await signOutOnDevHome(page);
  await expect(page.getByRole("status")).toHaveText("ログアウトしました");
});

test("この browser でログインした利用者を一覧に足し、候補が 8 人を超えたら、絞り込み欄に名前かメールの一部を入れると一致しない利用者を隠し、一致が無ければそう出し、残った利用者を押してログインできる", async ({
  page,
}) => {
  const firstCreated = await signInAsNewUserInThisBrowser(page);
  for (let created = 1; created < 6; created++) await signInAsNewUserInThisBrowser(page);
  await expect(accountButton(page, firstCreated)).toBeVisible();

  await accountFilter(page).fill("no-such-user");
  await expect(accountList(page)).toContainText("「no-such-user」に一致する利用者はいません。");

  await accountFilter(page).fill("DEV-OWNER");

  await expect(accountButton(page, OWNER.email)).toBeVisible();
  await expect(accountButton(page, ADMIN_EMAIL)).toBeHidden();

  await chooseOnDevHome(page, OWNER.email);
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
  await expect(signedInEmail(page, OWNER.email)).toBeVisible();
});

test("利用者を選んだ直後は、ログインしたことを出す", async ({ page }) => {
  await page.goto(DEV_HOME_PATH);
  await chooseOnDevHome(page, ADMIN_EMAIL);

  await expect(page.getByRole("status")).toHaveText("開発用 ADMIN でログインしました");
});

test("better-auth の magic-link の verify は相対の callbackURL の query に : や * があると拒むが、encode していない redirect_url の query で開いた開発者ホームでも、選ぶと開発者ホームに戻ってログインしたことを出す", async ({
  page,
}) => {
  const redirectUrl = `${BASE_URL}/account?q=a*b`;
  await page.goto(`${DEV_HOME_PATH}?service_name=accounts&redirect_url=${redirectUrl}`);

  await accountButton(page, ADMIN_EMAIL).click();

  await expect(page.getByRole("status")).toHaveText("開発用 ADMIN でログインしました");
  await expect(signedInEmail(page, ADMIN_EMAIL)).toBeVisible();
  await expect(page.getByRole("link", { name: "アプリケーションに戻る" })).toHaveAttribute(
    "href",
    redirectUrl,
  );
});

test("既存の画面と同じ CSS が当たり、書体は Inter で、上端の帯は primary の色である", async ({
  page,
}) => {
  await page.goto(DEV_HOME_PATH);

  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Inter");
  await expect(page.getByRole("banner")).toHaveCSS("background-color", "rgb(23, 23, 23)");
});

test("幅 390px では、長いメールの利用者がいても横に溢れない", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsNewUserInThisBrowser(page);
  await signInAsNewUserInThisBrowser(page);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("キーボードで戻り先の link、利用者のボタンの順に移れ、focus が見える", async ({ page }) => {
  await page.goto(DEV_HOME_PATH);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "アカウント管理画面を開く" })).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(accountButton(page, OWNER.email)).toBeFocused();
  expect(await focusIsVisible(page)).toBe(true);
});
