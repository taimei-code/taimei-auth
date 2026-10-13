import { expect, test, type Page } from "@playwright/test";
import {
  companySwitcher,
  reseedFixture,
  signInWithMagicLink,
  SWITCH_EMAIL,
  watchMainFrameNavigations,
} from "./helpers";

test.beforeEach(() => reseedFixture("switch"));

const companyRow = (page: Page, name: string) =>
  page.getByRole("main").locator("div.rounded-md.border").filter({ hasText: name });

test("事業所を追加すると、再読み込みなしで事業所一覧に載り、現在の事業所になる", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/companies");
  await expect(companyRow(page, "e2e-co-switch-a")).toBeVisible();
  const navigations = watchMainFrameNavigations(page);

  await page.getByRole("button", { name: "事業所を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事業所名").fill("e2e-co-switch-added");
  await dialog.getByRole("button", { name: "作成する" }).click();

  await expect(
    page.getByText("「e2e-co-switch-added」を作成し、現在の事業所に切り替えました。"),
  ).toBeVisible();
  await expect(companySwitcher(page).locator("option:checked")).toHaveText("e2e-co-switch-added");
  await expect(companyRow(page, "e2e-co-switch-added")).toBeVisible();
  expect(navigations.count()).toBe(0);
});

test("事業所設定は切替で入力欄を入れ直し、保存すると再読み込みなしで新しい名前になる", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/company-settings");
  const nameInput = page.getByLabel("事業所名");
  await expect(nameInput).toHaveValue("e2e-co-switch-a");

  await companySwitcher(page).selectOption({ label: "e2e-co-switch-b" });
  await expect(nameInput).toHaveValue("e2e-co-switch-b");
  const navigations = watchMainFrameNavigations(page);

  await nameInput.fill("e2e-co-switch-b-renamed");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("事業所情報を更新しました。")).toBeVisible();
  await expect(companySwitcher(page).locator("option:checked")).toHaveText(
    "e2e-co-switch-b-renamed",
  );
  await expect(nameInput).toHaveValue("e2e-co-switch-b-renamed");
  expect(navigations.count()).toBe(0);

  await page.getByRole("link", { name: "所属事業所", exact: true }).click();
  await expect(companyRow(page, "e2e-co-switch-b-renamed")).toBeVisible();
});

test("保存は成功したが事業所の状態の再取得が失敗すると、再読み込みの案内を出す", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/company-settings");
  const nameInput = page.getByLabel("事業所名");
  await companySwitcher(page).selectOption({ label: "e2e-co-switch-b" });
  await expect(nameInput).toHaveValue("e2e-co-switch-b");
  let failedRefetches = 0;
  await page.route("**/api/account/memberships", async (route) => {
    failedRefetches++;
    await route.fulfill({ status: 500, body: "" });
  });

  await nameInput.fill("e2e-co-switch-b-renamed");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(
    page.getByText(
      "事業所情報を更新しましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
    ),
  ).toBeVisible();
  await expect(page.getByText("事業所情報を更新しました。")).toHaveCount(0);
  expect(failedRefetches).toBeGreaterThanOrEqual(1);
});

test("事業所一覧の切替を押すと、再読み込みなしでその事業所に選択中が移る", async ({ page }) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/companies");
  const rowA = companyRow(page, "e2e-co-switch-a");
  const rowB = companyRow(page, "e2e-co-switch-b");
  await expect(rowA.getByText("選択中")).toBeVisible();
  await expect(rowB.getByText("選択中")).toHaveCount(0);
  const navigations = watchMainFrameNavigations(page);

  await rowB.getByRole("button", { name: "切替" }).click();

  await expect(rowB.getByText("選択中")).toBeVisible();
  await expect(rowA.getByText("選択中")).toHaveCount(0);
  expect(navigations.count()).toBe(0);
});

test("唯一のオーナーは抜けられず、委譲した後は再読み込みなしで管理者になり、抜けられる", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/companies");
  const rowA = companyRow(page, "e2e-co-switch-a");
  await expect(rowA).toBeVisible();
  const navigations = watchMainFrameNavigations(page);

  await rowA.getByRole("button", { name: "抜ける" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。",
  );

  await rowA.getByRole("button", { name: "オーナーを委譲" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("E2E SwitchAMate")).toBeVisible();
  await expect(dialog.getByText("E2E Switch", { exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "委譲" }).click();
  await expect(page.getByText("E2E SwitchAMate にオーナーを委譲しました。")).toBeVisible();
  await expect(rowA.getByText(/管理者/)).toBeVisible();
  expect(navigations.count()).toBe(0);

  await rowA.getByRole("button", { name: "抜ける" }).click();
  await expect(page.getByText("「e2e-co-switch-a」から抜けました。")).toBeVisible();
  await expect(companyRow(page, "e2e-co-switch-a")).toHaveCount(0);
  expect(navigations.count()).toBe(0);
});

test("委譲の一覧の取得が失敗すると、招待を促す文言ではなく取得の失敗を出す", async ({ page }) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/companies");
  const rowA = companyRow(page, "e2e-co-switch-a");
  await rowA.getByRole("button", { name: "抜ける" }).click();
  await page.route("**/api/account/companies/*/members", async (route) => {
    await route.fulfill({ status: 500, body: "" });
  });

  await rowA.getByRole("button", { name: "オーナーを委譲" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("メンバーの取得に失敗しました。")).toBeVisible();
  await expect(dialog.getByText("委譲できるメンバーがいません", { exact: false })).toHaveCount(0);
});

test("サイドバーで切替中は、事業所一覧の切替ボタンも押せない", async ({ page }) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/companies");
  let releaseSwitch: () => void = () => {};
  const switchHeld = new Promise<void>((resolve) => {
    releaseSwitch = resolve;
  });
  await page.route("**/api/account/current-company", async (route) => {
    await switchHeld;
    await route.continue();
  });
  const rowB = companyRow(page, "e2e-co-switch-b");
  await expect(rowB.getByRole("button", { name: "切替" })).toBeEnabled();

  await companySwitcher(page).selectOption({ label: "e2e-co-switch-b" });

  await expect(rowB.getByRole("button", { name: "切替" })).toBeDisabled();
  releaseSwitch();
  await expect(rowB.getByText("選択中")).toBeVisible();
});
