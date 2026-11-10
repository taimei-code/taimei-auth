import { expect, type Page, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

const DIALOG_PARTS = { backdrop: "dialog > :first-child", panel: 'dialog > [id$="-panel"]' };

const recordDialogTransitions = (page: Page) =>
  page.evaluate((parts) => {
    document.addEventListener("transitionstart", ({ target, propertyName }) => {
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const part = Object.entries(parts).find(([, selector]) => target.matches(selector))?.[0];
      if (part !== undefined) {
        const phase = target.hasAttribute("data-leave") ? "leave" : "enter";
        const recorded = document.documentElement.dataset.dialogTransitions ?? "";
        document.documentElement.dataset.dialogTransitions = `${recorded} ${part}:${propertyName}:${phase}`;
      }
    });
  }, DIALOG_PARTS);

const recordedDialogTransitions = (page: Page) =>
  page.evaluate(() => (document.documentElement.dataset.dialogTransitions ?? "").split(" "));

const fadesAndScales = (phase: "enter" | "leave") =>
  expect.arrayContaining([
    `backdrop:opacity:${phase}`,
    `panel:opacity:${phase}`,
    expect.stringMatching(new RegExp(`^panel:(transform|scale):${phase}$`)),
  ]);

test("唯一の OWNER の退会は中断され、エラーが表示されて /account に留まる", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "所有者として残っている事業所があります。先に委譲または削除してください。",
  );

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});

test("共同 OWNER がいれば退会でき、共通ログイン画面へ移り session が消える", async ({ page }) => {
  reseedFixture("withdraw");
  await signInWithMagicLink(page, "e2e-withdraw@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await page.getByRole("button", { name: "退会を確定する" }).click();

  await expectSignInLanding(page);
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.includes("session"))).toEqual([]);
});

test("dialog は開く時と閉じる時に backdrop と panel をフェードし、panel を拡大縮小する", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);
  await recordDialogTransitions(page);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect.poll(() => recordedDialogTransitions(page)).toEqual(fadesAndScales("enter"));

  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect.poll(() => recordedDialogTransitions(page)).toEqual(fadesAndScales("leave"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("動きを減らす設定の browser では、dialog は transition を持たずに開閉する", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInWithMagicLink(page, "e2e-danger@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.getByRole("button", { name: "退会する" }).click();
  await expect(page.locator(DIALOG_PARTS.panel)).toHaveCSS("transition-property", "none");
  await expect(page.locator(DIALOG_PARTS.backdrop)).toHaveCSS("transition-property", "none");

  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
