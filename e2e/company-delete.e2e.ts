import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

// 最後の事業所を削除するとアカウントも連動して削除され (ADR-0010 D3)、削除後はログイン画面へ着地する。
// 着地先が params の無い素の /auth だと SignIn の必須検証 (signInParamsSchema) に失敗して
// invalid_redirect_url のエラー画面が出る。この退行を、ログインフォームの表示まで確認して固定する。

test("最後の事業所削除はアカウントごと削除され、ログイン画面に着地する", async ({ page }) => {
  // delete ユーザーはこのテストがアカウントごと消費する (使い切りの fixture)
  reseedFixture("delete");
  await signInWithMagicLink(page, "e2e-delete@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/company-settings");
  await page.getByRole("button", { name: "削除する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("これは最後の所属事業所です")).toBeVisible();
  await dialog.getByRole("button", { name: "削除する" }).click();

  await expectSignInLanding(page);
});

// 所属が残る削除は、一覧への SPA 遷移と成功トーストで終わる (通知の経路は web/src/shared/notify.tsx で定義する)。
// 通知だけが気付かれないまま出なくなっても画面遷移は正しく見えるため、トーストの表示までを固定する。

const DELETED_COMPANY = "e2e-co-delete-multi-current";

test("所属が残る事業所削除は一覧へ遷移し、遷移先で成功トーストが出る", async ({ page }) => {
  // delete-multi ユーザーはこのテストが事業所ごと消費する (使い切りの fixture)
  reseedFixture("delete-multi");
  await signInWithMagicLink(page, "e2e-delete-multi@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/company-settings");
  // fixture が last_used_company_id で固定した現在の事業所が削除対象になる
  await expect(page.getByLabel("事業所名")).toHaveValue(DELETED_COMPANY);

  await page.getByRole("button", { name: "削除する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "削除する" }).click();

  await expect(page).toHaveURL(/\/account\/companies/);
  // toast は context の再取得が終わってから出るため、この 1 行が下の一覧の assertion の同期点も兼ねる
  // (順序を入れ替えると、一覧が再取得前の memberships と競合する)
  await expect(page.getByText(`「${DELETED_COMPANY}」を削除しました。`)).toBeVisible();

  // 一覧の確認は main に絞る。toast は AccountLayout で main の外に出るため、削除済み事業所が
  // 消えたかどうかを toast 文言中の事業所名で誤って判定しないようにする
  const main = page.getByRole("main");
  await expect(main.getByText("e2e-co-delete-multi-other")).toBeVisible();
  await expect(main.getByText(DELETED_COMPANY)).toHaveCount(0);
});
