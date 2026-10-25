import { expect, test } from "@playwright/test";
import {
  authEntryUrl,
  BASE_URL,
  reseedFixture,
  sendMagicLinkFromForm,
  sentLinkAfter,
  signInWithMagicLink,
} from "./helpers";

test.beforeEach(() => reseedFixture("invitation"));

const INVITEE_EMAIL = "e2e-invitee@example.com";
const INVITATION_TOKEN = "e2e-invitation-token";

test("SignIn 画面からの magic link でも招待を受諾でき /account に到達する", async ({ page }) => {
  let acceptPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/account/accept-invitation")) {
      acceptPosts++;
    }
  });
  await page.goto(authEntryUrl({ invitationToken: INVITATION_TOKEN }));

  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub でログイン" })).toHaveCount(0);

  const link = await sendMagicLinkFromForm(page, INVITEE_EMAIL);

  await page.goto(link);

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
  expect(acceptPosts).toBe(1);

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
  const invitationLink = await sentLinkAfter(INVITEE_EMAIL, () =>
    inviteForm.getByRole("button", { name: "招待する" }).click(),
  );
  const callbackURL = new URL(invitationLink).searchParams.get("callbackURL") ?? "";
  expect(new URL(callbackURL).searchParams.get("redirect_url")).toBe(redirectUrl);

  const inviteePage = await (await browser.newContext()).newPage();
  await inviteePage.goto(invitationLink);
  await expect(inviteePage).toHaveURL(redirectUrl);
});

test("招待された人と違う user が受諾すると、宛先違いの文言を出す", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await expect(page).toHaveURL(/\/account/);

  await page.goto(`/auth/signup/accept-invitation?invitation_token=${INVITATION_TOKEN}`);

  await expect(
    page.getByText(
      "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
    ),
  ).toBeVisible();
});
