import { expect, test, type Page } from "@playwright/test";
import { routeEndpoint } from "./contract-mock";
import { reseedFixture, signInWithMagicLink } from "./helpers";

const MFA_EMAIL = "e2e-mfa@example.com";
const DIALOG_TITLE = "多要素認証 (MFA) を有効にする";
const DIALOG_DESCRIPTION = "認証アプリを登録すると、ログイン時に確認コードの入力を求めます。";
const TAB_PRESSES = 15;

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  reseedFixture("mfa");
  await signInWithMagicLink(page, MFA_EMAIL);
});

const mfaRow = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: "多要素認証 (MFA)" });

const openEnrollDialog = async (page: Page) => {
  await page.goto("/account/security");
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "次へ" })).toBeVisible();
  return dialog;
};

const textOfIdReference = (page: Page, attribute: "aria-labelledby" | "aria-describedby") =>
  page.evaluate((name) => {
    const dialog = document.querySelector('[role="dialog"], dialog[open]');
    const ids = dialog?.getAttribute(name)?.split(/\s+/) ?? [];
    return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ");
  }, attribute);

test("有効化のダイアログは modal の dialog として、見出しと説明を名指す", async ({ page }) => {
  const dialog = await openEnrollDialog(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(await textOfIdReference(page, "aria-labelledby")).toBe(DIALOG_TITLE);
  expect(await textOfIdReference(page, "aria-describedby")).toBe(DIALOG_DESCRIPTION);
});

test("有効化のダイアログを開いている間、Tab を押し続けても focus はダイアログの外に出ない", async ({
  page,
}) => {
  await openEnrollDialog(page);
  for (let press = 0; press < TAB_PRESSES; press++) {
    await page.keyboard.press("Tab");
    const insideDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"], dialog[open]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(insideDialog, `Tab を ${press + 1} 回押した後`).toBe(true);
  }
});

test("有効化のダイアログを Escape で閉じると、開いた button に focus が戻る", async ({ page }) => {
  const dialog = await openEnrollDialog(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(mfaRow(page).getByRole("button", { name: "有効にする" })).toBeFocused();
});

test("有効化のダイアログを開いている間、背景の button は操作の対象に出ない", async ({ page }) => {
  await page.goto("/account/security");
  await expect(page.getByRole("button", { name: "ログアウト" })).toHaveCount(1);
  await openEnrollDialog(page);
  await expect(page.getByRole("button", { name: "ログアウト" })).toHaveCount(0);
});

test("有効化の送信中は、Escape を押してもダイアログを閉じない", async ({ page }) => {
  let releaseActivate: () => void = () => {};
  const activateHeld = new Promise<void>((resolve) => {
    releaseActivate = resolve;
  });
  await routeEndpoint(page, "mfa.activate", async (route) => {
    await activateHeld;
    await route.continue();
  });
  const dialog = await openEnrollDialog(page);
  await dialog.getByRole("button", { name: "次へ" }).click();
  const codeInput = dialog.locator("#mfa-enroll-code");
  await codeInput.fill("123456");
  await dialog.getByRole("button", { name: "有効にする" }).click();
  await expect(codeInput).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseActivate();
  await expect(dialog.getByRole("alert")).toBeVisible();
});
