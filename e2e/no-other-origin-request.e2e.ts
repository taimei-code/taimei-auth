import { expect, type Page, test } from "@playwright/test";
import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { authEntryUrl, BASE_URL } from "./helpers";

const otherOriginRequestsWhileOpening = async (page: Page, url: string, heading: string) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(BASE_URL).origin) {
      requested.push(request.url());
    }
  });
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return requested;
};

test("共通ログイン画面を開いても、別の origin へ要求を出さない。外部の font を読んで描画を止めたり、画面を開いた事実を第三者に送ったりしないため", async ({
  page,
}) => {
  expect(
    await otherOriginRequestsWhileOpening(page, authEntryUrl(), "taimei-auth にログイン"),
  ).toEqual([]);
});

test("開発者ホームを開いても、別の origin へ要求を出さない", async ({ page }) => {
  expect(await otherOriginRequestsWhileOpening(page, DEV_HOME_PATH, "開発者ホーム")).toEqual([]);
});
