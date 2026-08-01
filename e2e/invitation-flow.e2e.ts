import { expect, test } from "@playwright/test";
import { authEntryUrl, magicLinkFor } from "./helpers";

// 招待リンクを未ログインで開くと SignIn 画面に着地する。この画面からの magic link 送信でも
// accept-invitation へ着地して membership が作られること (invitation_token が SignIn 経路で
// 捨てられていた退行の再発防止) を固定する。

const INVITEE_EMAIL = "e2e-invitee@example.com";
const INVITATION_TOKEN = "e2e-invitation-token";

test("SignIn 画面からの magic link でも招待を受諾でき /account に到達する", async ({ page }) => {
  await page.goto(authEntryUrl({ invitationToken: INVITATION_TOKEN }));

  // 招待経由では GitHub ログインを出さない (strict email match が Magic Link 前提)
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub でログイン" })).toHaveCount(0);

  await page.getByPlaceholder("you@example.com").fill(INVITEE_EMAIL);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(INVITEE_EMAIL));

  // accept-invitation 着地 → membership 作成 → /account へ
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  // 受諾の結果、招待元事業所のメンバーとして自分が載っている
  await page.goto("/account/members");
  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText(INVITEE_EMAIL).first()).toBeVisible();
});
