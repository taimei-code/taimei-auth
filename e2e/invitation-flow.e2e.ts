import { expect, test } from "@playwright/test";
import { authEntryUrl, magicLinkFor, reseedFixture } from "./helpers";

test.beforeEach(() => reseedFixture("invitation"));

const INVITEE_EMAIL = "e2e-invitee@example.com";
const INVITATION_TOKEN = "e2e-invitation-token";

test("SignIn 画面からの magic link でも招待を受諾でき /account に到達する", async ({ page }) => {
  await page.goto(authEntryUrl({ invitationToken: INVITATION_TOKEN }));

  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub でログイン" })).toHaveCount(0);

  await page.getByPlaceholder("you@example.com").fill(INVITEE_EMAIL);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(INVITEE_EMAIL));

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  await page.goto("/account/members");
  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText(INVITEE_EMAIL).first()).toBeVisible();
});
