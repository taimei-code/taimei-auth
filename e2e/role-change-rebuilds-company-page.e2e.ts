import { expect, test } from "@playwright/test";
import { endpointPattern, routeEndpoint } from "./contract-mock";
import { BASE_URL, reseedFixture, signInWithMagicLink, SWITCH_EMAIL } from "./helpers";

const TRANSFER = "membership.transferOwnership";

test("オーナーの委譲の応答を待つ間に「戻る」で事業所設定の page へ移り、応答が届くと、page がオーナーのみの案内になる", async ({
  page,
}) => {
  reseedFixture("switch");
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.getByRole("link", { name: "事業所設定" }).click();
  await expect(page.getByLabel("事業所名")).toBeVisible();
  await page.getByRole("link", { name: "所属事業所" }).click();

  const soleOwnerCompany = page
    .getByRole("main")
    .locator("div.rounded-md.border")
    .filter({ hasText: "e2e-co-switch-a" });
  await soleOwnerCompany.getByRole("button", { name: "抜ける" }).click();
  await soleOwnerCompany.getByRole("button", { name: "オーナーを委譲" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("E2E SwitchAMate")).toBeVisible();

  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = page.waitForRequest(endpointPattern(TRANSFER));
  await routeEndpoint(
    page,
    TRANSFER,
    async (route) => {
      await released;
      await route.continue();
    },
    { times: 1 },
  );
  await dialog.getByRole("button", { name: "委譲" }).click();
  await requested;

  await page.goBack();
  await expect(page).toHaveURL(`${BASE_URL}/account/company-settings`);
  await expect(page.getByLabel("事業所名")).toBeVisible();

  const answered = page.waitForResponse(endpointPattern(TRANSFER));
  release();
  await answered;

  await expect(page.getByText("事業所設定の編集はオーナーのみ可能です。")).toBeVisible();
  await expect(page.getByLabel("事業所名")).toHaveCount(0);
});
