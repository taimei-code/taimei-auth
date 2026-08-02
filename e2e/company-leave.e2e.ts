import { expect, test } from "@playwright/test";
import { expectSignInLanding, reseedFixture, signInWithMagicLink } from "./helpers";

// leaver は本テストがアカウントごと消費する (消費型 fixture)
test.beforeEach(() => reseedFixture("leave"));

// 最後の所属事業所から「抜ける」は退会と同じアカウント連動削除になる (ADR-0010 D2)。
// 削除成功後にそのまま membership refresh へ進むと 401 を拾って
// 「事業所から抜けられませんでした。」と誤表示される退行があったため、
// ログイン画面への着地までを確認して固定する。

test("最後の所属事業所から抜けるとアカウントごと削除され、ログイン画面に着地する", async ({
  page,
}) => {
  await signInWithMagicLink(page, "e2e-leaver@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto("/account/companies");
  await page.getByRole("button", { name: "抜ける" }).click();

  await expectSignInLanding(page);
});
