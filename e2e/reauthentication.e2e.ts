import { expect, type Page, test } from "@playwright/test";
import { routeOutsideContract } from "./contract-mock";
import {
  addVirtualAuthenticator,
  BASE_URL,
  enableMfaViaApi,
  MFA_EMAIL,
  PASSKEY_EMAIL,
  passkeyItems,
  registerPasskeyButton,
  reseedFixture,
  sendMagicLinkFromForm,
  signInWithMagicLink,
  totpCode,
} from "./helpers";

const SIGN_IN_EMAIL = "e2e-signin@example.com";
const RETURN_TO = `${BASE_URL}/account/security`;

test.describe.configure({ timeout: 90_000 });

const reauthenticationUrl = (redirectUrl: string = RETURN_TO) => {
  const url = new URL("/auth/reauthenticate", BASE_URL);
  url.searchParams.set("redirect_url", redirectUrl);
  return url.toString();
};

const signInUrl = () => {
  const url = new URL("/auth/", BASE_URL);
  url.searchParams.set("service_name", "accounts");
  url.searchParams.set("redirect_url", RETURN_TO);
  return url.toString();
};

const sessionIdOf = async (page: Page): Promise<string> => {
  const response = await page.request.get("/api/auth/get-session");
  const body = (await response.json()) as { session: { id: string } } | null;
  if (body === null) throw new Error("session が無い");
  return body.session.id;
};

const signedIn = async (page: Page, email: string): Promise<string> => {
  await signInWithMagicLink(page, email);
  await expect(page).toHaveURL(/\/account/);
  return sessionIdOf(page);
};

const signInAgainWithMagicLink = async (page: Page, email: string) => {
  await page.goto(reauthenticationUrl());
  const link = await sendMagicLinkFromForm(page, email);
  await page.goto(link);
};

test("ログイン済みの user が再認証の入口を開くと、元の画面へ戻されずにログインの手段が出る", async ({
  page,
}) => {
  await signedIn(page, SIGN_IN_EMAIL);

  await page.goto(reauthenticationUrl());

  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub でログイン" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/auth/reauthenticate");
});

test("ログイン済みの user が共通ログイン画面を開くと、今まで通り redirect_url へ戻される", async ({
  page,
}) => {
  await signedIn(page, SIGN_IN_EMAIL);

  await page.goto(signInUrl());

  await expect(page).toHaveURL(RETURN_TO);
});

test("MFA を有効にしていない user が Magic Link でログインし直すと、新しい session で指定した画面へ戻り、前の session も使える", async ({
  page,
  request,
}) => {
  const sessionBefore = await signedIn(page, SIGN_IN_EMAIL);
  const cookieHeaderBefore = (await page.context().cookies())
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  await signInAgainWithMagicLink(page, SIGN_IN_EMAIL);

  await expect(page).toHaveURL(RETURN_TO);
  expect(await sessionIdOf(page)).not.toBe(sessionBefore);
  const previous = await request.get("/api/auth/get-session", {
    headers: { cookie: cookieHeaderBefore },
  });
  expect(await previous.json()).toMatchObject({ session: { id: sessionBefore } });
});

test("MFA を有効にした user は、MFA チャレンジを通ってから指定した画面へ戻る", async ({ page }) => {
  reseedFixture("mfa");
  await signedIn(page, MFA_EMAIL);
  const { secret } = await enableMfaViaApi(page);

  await signInAgainWithMagicLink(page, MFA_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa/);
  await page.locator("#mfa-challenge-code").fill(await totpCode(secret));
  await page.getByRole("button", { name: "ログインを続ける" }).click();

  await expect(page).toHaveURL(RETURN_TO);
});

test("パスキーでログインし直すと、新しい session で指定した画面へ戻る", async ({ page }) => {
  reseedFixture("passkey");
  await addVirtualAuthenticator(page);
  await signedIn(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await registerPasskeyButton(page).click();
  await expect(passkeyItems(page)).toHaveCount(1);
  const sessionBefore = await sessionIdOf(page);

  await page.goto(reauthenticationUrl());
  await page.getByRole("button", { name: "パスキーでログイン" }).click();

  await expect(page).toHaveURL(RETURN_TO);
  expect(await sessionIdOf(page)).not.toBe(sessionBefore);
});

test("ログインし直さずに元の画面へ戻ると、同じ session のまま指定した画面へ移る", async ({
  page,
}) => {
  const sessionBefore = await signedIn(page, SIGN_IN_EMAIL);

  await page.goto(reauthenticationUrl());
  await page.getByRole("link", { name: "元の画面へ戻る" }).click();

  await expect(page).toHaveURL(RETURN_TO);
  expect(await sessionIdOf(page)).toBe(sessionBefore);
});

test("GitHub でログインし直す時は、指定した画面を戻り先として GitHub のログインを始める", async ({
  page,
}) => {
  await signedIn(page, SIGN_IN_EMAIL);
  const started: unknown[] = [];
  await routeOutsideContract(page, /\/api\/auth\/sign-in\/social$/, async (route) => {
    started.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, json: {} });
  });

  await page.goto(reauthenticationUrl());
  await page.getByRole("button", { name: "GitHub でログイン" }).click();

  await expect.poll(() => started).toEqual([{ provider: "github", callbackURL: RETURN_TO }]);
});

for (const [kind, redirectUrl] of [
  ["allowlist に無い host", "https://evil.example.com/"],
  ["auth ホストでないプロダクトの host", "http://app.taimei-code.localhost/"],
]) {
  test(`再認証の入口に${kind}の戻り先を渡すと、不正なリダイレクト URL のエラー画面へ移る`, async ({
    page,
  }) => {
    await page.goto(reauthenticationUrl(redirectUrl));

    await expect(page).toHaveURL(`${BASE_URL}/auth/error?reason=invalid_redirect_url`);
  });
}
