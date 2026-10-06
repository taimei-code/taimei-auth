import { expect, test } from "@playwright/test";
import {
  authEntryUrl,
  BASE_URL,
  magicLinkFor,
  reseedFixture,
  signInWithMagicLink,
} from "./helpers";

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

test("メンバー画面が受けた redirect_url へ、招待された人が受諾後に着地する", async ({
  page,
  browser,
}) => {
  const redirectUrl = `${BASE_URL}/health`;
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await page.goto(
    `/account/members?service_name=taimei&redirect_url=${encodeURIComponent(redirectUrl)}`,
  );
  const inviteForm = page.getByRole("region", { name: "メンバーを招待" });
  await inviteForm.getByLabel("メールアドレス").fill(INVITEE_EMAIL);
  await inviteForm.getByRole("button", { name: "招待する" }).click();

  // 招待メールは応答の後に送られるので、この招待の redirect_url を持つリンクが出るまで待つ
  const redirectUrlInMagicLink = (magicLink: string) => {
    const callbackURL = new URL(magicLink).searchParams.get("callbackURL") ?? "";
    return new URL(callbackURL).searchParams.get("redirect_url");
  };
  await expect
    .poll(async () => redirectUrlInMagicLink(await magicLinkFor(INVITEE_EMAIL)))
    .toBe(redirectUrl);

  const inviteePage = await (await browser.newContext()).newPage();
  await inviteePage.goto(await magicLinkFor(INVITEE_EMAIL));
  await expect(inviteePage).toHaveURL(redirectUrl);
});
