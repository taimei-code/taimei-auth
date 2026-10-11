import { expect, test } from "@playwright/test";
import { reseedFixture, signInWithMagicLink } from "./helpers";

test.beforeEach(() => reseedFixture("switch"));

test("事業所を切り替えた後、前の事業所の遅れて届いた一覧を表示しない", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-switch@example.com");

  let delayed = false;
  await page.route("**/api/account/companies/*/members", async (route) => {
    if (!delayed) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.continue();
  });

  await page.goto("/account/members");
  const switcher = page.getByRole("combobox", { name: "事業所を切り替え" });
  await expect(switcher).toHaveValue(/.+/);
  await switcher.selectOption({ label: "e2e-co-switch-b" });

  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText("E2E SwitchBMate")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __staleRows: number };
    w.__staleRows = 0;
    new MutationObserver(() => {
      if (document.body.textContent?.includes("E2E SwitchAMate")) w.__staleRows += 1;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.waitForTimeout(2_500);

  expect(delayed).toBe(true);
  expect(
    await page.evaluate(() => (window as unknown as { __staleRows: number }).__staleRows),
  ).toBe(0);
  await expect(list.getByText("E2E SwitchAMate")).toHaveCount(0);
  await expect(list.getByText("E2E SwitchBMate")).toBeVisible();
});
