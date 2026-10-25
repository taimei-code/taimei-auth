import { expect, test, type Page } from "@playwright/test";
import { signInThroughMagicLinkForm, signInWithMagicLink } from "./helpers";
import { declaredFailure, routeEndpoint } from "./contract-mock";

const signUpUntilCompanyForm = async (page: Page): Promise<void> => {
  await signInWithMagicLink(page, `e2e-newbie-${Date.now()}@example.com`);
  await expect(page.getByText("事業所を登録してください")).toBeVisible();
};

const submitCompanyForm = async (page: Page): Promise<void> => {
  await page.getByLabel("事業所名").fill(`e2e-co-newbie-${Date.now()}`);
  await page.getByRole("button", { name: "事業所を作成" }).click();
};

const expectAccountReached = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
};

test("既存 user の magic link sign-in は /account に到達し、ログアウトで sign-in 画面へ戻る", async ({
  page,
}) => {
  await signInThroughMagicLinkForm(page, "e2e-signin@example.com");

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();

  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});

test("新規 user の sign-up は事業所登録に誘導され、作成後に /account へ到達する", async ({
  page,
}) => {
  await signUpUntilCompanyForm(page);

  await submitCompanyForm(page);

  await expectAccountReached(page);
});

test("使用済み magic link の再クリックでは session を得られない", async ({ page, context }) => {
  const usedLink = await signInWithMagicLink(page, "e2e-signin@example.com");
  await expect(page).toHaveURL(/\/account/);

  await context.clearCookies();
  await page.goto(usedLink);

  await expect(page).toHaveURL(/\/auth\//);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
});

test("session の無い browser で /account を開くとログイン画面に移る", async ({ page }) => {
  await page.goto("/account");

  await expect(page).toHaveURL(/\/auth\//);
});

test("事業所登録の作成が失敗すると、応答の body ではなく固定の文言を出す", async ({ page }) => {
  await signUpUntilCompanyForm(page);
  let failedRequests = 0;
  await routeEndpoint(page, "company.create", async (route) => {
    failedRequests++;
    await route.fulfill({ status: 500, json: { leaked: "upstream-detail" } });
  });

  await submitCompanyForm(page);

  await expect(page.getByText("事業所登録に失敗しました")).toBeVisible();
  expect(failedRequests).toBe(1);
  await expect(page.getByText("upstream-detail")).toHaveCount(0);
});

test("事業所登録の作成が AlreadyExists (別のタブで作成済み) なら、エラーを出さずに遷移先へ移る", async ({
  page,
}) => {
  await signUpUntilCompanyForm(page);
  await routeEndpoint(page, "company.create", async (route) => {
    await route.fetch();
    await route.fulfill(declaredFailure("company.create", "AlreadyExists"));
  });

  await submitCompanyForm(page);

  await expectAccountReached(page);
});
