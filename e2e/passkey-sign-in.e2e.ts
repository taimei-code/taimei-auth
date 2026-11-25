import { expect, type Page, test } from "@playwright/test";
import { declaredFailure, routeEndpoint } from "./contract-mock";
import {
  addVirtualAuthenticator,
  BASE_URL,
  confirmDeletionOf,
  enableMfaViaApi,
  featureFlags,
  PASSKEY_EMAIL,
  passkeyItems,
  registerPasskeyButton,
  reseedFixture,
  sentLinkAfter,
  signInWithMagicLink,
} from "./helpers";

const PASSKEY = "passkey";
const REDIRECT_URL = `${BASE_URL}/account/sessions`;

const signInUrl = (path: "/auth/" | "/auth/signup" = "/auth/") => {
  const url = new URL(path, BASE_URL);
  url.searchParams.set("service_name", "accounts");
  url.searchParams.set("redirect_url", REDIRECT_URL);
  return url.toString();
};

const passkeySignInButton = (page: Page) =>
  page.getByRole("button", { name: "パスキーでログイン" });

const countSettledGets = () => {
  const credentials = navigator.credentials;
  const get = credentials.get.bind(credentials);
  const state = { settled: 0 };
  Object.assign(window, { __settledGets: state });
  credentials.get = (options) =>
    get(options).finally(() => {
      state.settled += 1;
    });
};

const settledGets = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __settledGets: { settled: number } }).__settledGets.settled,
  );

const removeWebAuthn = () => {
  Reflect.deleteProperty(window, "PublicKeyCredential");
};

const registerPasskey = async (page: Page) => {
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await registerPasskeyButton(page).click();
  await expect(passkeyItems(page)).toHaveCount(1);
};

const registerPasskeyAndSignOut = async (page: Page) => {
  await registerPasskey(page);
  await page.context().clearCookies();
};

const deleteListedPasskey = async (page: Page) => {
  await page.goto("/account/security");
  await confirmDeletionOf(page, passkeyItems(page));
  await expect(page.getByText("パスキーを削除しました。")).toBeVisible();
};

const registerDeleteAndSignOut = async (page: Page) => {
  await registerPasskey(page);
  await deleteListedPasskey(page);
  await page.context().clearCookies();
};

const failureTextAfterPasskeySignIn = async (page: Page) => {
  await page.goto(signInUrl());
  await passkeySignInButton(page).click();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  return alert.innerText();
};

const openAfterLoadSettled = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("button", { name: /GitHub/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
};

test.beforeEach(() => reseedFixture("passkey"));

test.afterEach(({ request }) => featureFlags(request).on(PASSKEY));

test("パスキーを登録した user は、共通ログイン画面でメールアドレスを入れずにパスキーでログインし、受けた redirect_url へ移る", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await registerPasskeyAndSignOut(page);
  await page.goto(signInUrl());

  await passkeySignInButton(page).click();

  await expect(page).toHaveURL(REDIRECT_URL);
});

test("MFA を有効にした user は、パスキーでログインすると MFA チャレンジの画面を開かずに redirect_url へ移る", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await enableMfaViaApi(page);
  await page.goto("/account/security");
  await registerPasskeyButton(page).click();
  await expect(passkeyItems(page)).toHaveCount(1);
  await page.context().clearCookies();
  await page.goto(signInUrl());
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });

  await passkeySignInButton(page).click();

  await expect(page).toHaveURL(REDIRECT_URL);
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname).toBe(new URL(REDIRECT_URL).pathname);
  expect(visited.filter((path) => path.startsWith("/auth/mfa"))).toEqual([]);
});

test("共通サインアップ画面には、フラグが全体 on でパスキーに対応した browser でも、パスキーの入口が出ない", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await featureFlags(page.request).on(PASSKEY);

  await openAfterLoadSettled(page, signInUrl("/auth/signup"));

  expect(await passkeySignInButton(page).count()).toBe(0);
});

test("PublicKeyCredential の無い browser では、フラグが全体 on でも、共通ログイン画面にパスキーの入口が出ない", async ({
  page,
}) => {
  await page.addInitScript(removeWebAuthn);
  await featureFlags(page.request).on(PASSKEY);

  await openAfterLoadSettled(page, signInUrl());

  expect(await passkeySignInButton(page).count()).toBe(0);
});

test("フラグが全体 off の時は、パスキーに対応した browser でも、共通ログイン画面にパスキーの入口が出ない", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await featureFlags(page.request).off(PASSKEY);

  await openAfterLoadSettled(page, signInUrl());

  expect(await passkeySignInButton(page).count()).toBe(0);
});

test("削除済みのパスキーでログインしようとすると、共通ログイン画面にとどまり、失敗の文言が出る", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await registerDeleteAndSignOut(page);

  const failure = await failureTextAfterPasskeySignIn(page);

  expect(failure).not.toBe("");
  expect(new URL(page.url()).pathname).toBe("/auth/");
});

test("削除済みのパスキーでのログインに失敗した後も、同じ画面で Magic Link を送れ、GitHub でログインできる", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await registerDeleteAndSignOut(page);
  await failureTextAfterPasskeySignIn(page);

  await expect(page.getByRole("button", { name: "GitHub でログイン" })).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(PASSKEY_EMAIL);
  await sentLinkAfter(PASSKEY_EMAIL, () =>
    page.getByRole("button", { name: "Magic Link を送信" }).click(),
  );
  await expect(page.getByText("に Magic Link を送信しました。")).toBeVisible();
});

test("ログインの API が試行枠の超過で拒んだ時の文言は、削除済みのパスキーで失敗した時の文言と同じ", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await registerPasskeyAndSignOut(page);
  await routeEndpoint(page, "passkeySignIn.verify", (route) =>
    route.fulfill(declaredFailure("passkeySignIn.verify", "RateLimited")),
  );
  const rateLimited = await failureTextAfterPasskeySignIn(page);
  await page.unrouteAll();
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await deleteListedPasskey(page);
  await page.context().clearCookies();

  const deleted = await failureTextAfterPasskeySignIn(page);

  expect(rateLimited).toBe(deleted);
});

test("browser の確認の dialog を取り消すと、誤りは出ず、続けてパスキーでログインできる", async ({
  page,
}) => {
  await page.addInitScript(countSettledGets);
  const authenticator = await addVirtualAuthenticator(page);
  await registerPasskeyAndSignOut(page);
  await page.goto(signInUrl());
  await authenticator.refuseUser();

  await passkeySignInButton(page).click();
  await expect.poll(() => settledGets(page)).toBe(1);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await page.getByRole("alert").count()).toBe(0);

  await authenticator.verifyUser();
  await passkeySignInButton(page).click();
  await expect(page).toHaveURL(REDIRECT_URL);
});
