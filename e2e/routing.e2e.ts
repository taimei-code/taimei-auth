import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, expectSignInLanding, signInWithMagicLink } from "./helpers";

const EVIL_URL = "https://evil.example.com/";

const signedIn = async (page: Page) => {
  await signInWithMagicLink(page, "e2e-signin@example.com");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
};

const returnToOf = (url: string) => new URL(url).searchParams.get("redirect_url");

test("許可されていない redirect_url のログイン画面は、不正なリダイレクト URL のエラー画面に移る", async ({
  page,
}) => {
  await page.goto(`/auth?service_name=accounts&redirect_url=${encodeURIComponent(EVIL_URL)}`);

  await expect(page).toHaveURL(`${BASE_URL}/auth/error?reason=invalid_redirect_url`);
  await expect(page.getByText("不正なリダイレクト URL")).toBeVisible();
});

test("許可されていない redirect_url の新規登録画面も、同じエラー画面に移る", async ({ page }) => {
  await page.goto(
    `/auth/signup?service_name=accounts&redirect_url=${encodeURIComponent(EVIL_URL)}`,
  );

  await expect(page).toHaveURL(`${BASE_URL}/auth/error?reason=invalid_redirect_url`);
});

test("定義外の reason のエラー画面は既定の文言を出す", async ({ page }) => {
  await page.goto("/auth/error?reason=bogus");

  await expect(page.getByText("エラーが発生しました", { exact: true })).toBeVisible();
});

test("ログイン画面から新規登録への link は、宣言した search だけを引き継ぐ", async ({ page }) => {
  await page.goto(
    `/auth?service_name=accounts&redirect_url=${encodeURIComponent(`${BASE_URL}/account`)}&error=signin_failed`,
  );

  const href = await page.getByRole("link", { name: "新規登録" }).getAttribute("href");
  const search = new URL(href ?? "", BASE_URL).searchParams;
  expect(search.get("service_name")).toBe("accounts");
  expect(search.get("redirect_url")).toBe(`${BASE_URL}/account`);
  expect(search.has("error")).toBe(false);
});

test("存在しない path は既定のエラーの文言を出す", async ({ page }) => {
  await page.goto("/auth/no-such-page");

  await expect(page.getByText("エラーが発生しました", { exact: true })).toBeVisible();
});

test("session の無い browser で /account を開くと、末尾スラッシュ付きの /auth/ に document の読み込みで移る", async ({
  page,
}) => {
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(new URL(request.url()).pathname);
  });

  await page.goto("/account");

  await expect(page).toHaveURL(/\/auth\/\?service_name=accounts&redirect_url=/);
  expect(returnToOf(page.url())).toBe(`${BASE_URL}/account`);
  expect(documents).toContain("/auth/");
});

test("session の無い browser で /account/members を開くと、ログイン後の戻り先が /account/members になる", async ({
  page,
}) => {
  await page.goto("/account/members");

  await expect(page).toHaveURL(/\/auth\/\?/);
  expect(returnToOf(page.url())).toBe(`${BASE_URL}/account/members`);
});

test("事業所に所属しない user が /account を開くと、事業所登録に移る", async ({ page }) => {
  await signInWithMagicLink(page, `e2e-newbie-${Date.now()}@example.com`);
  await expect(page.getByText("事業所を登録してください")).toBeVisible();

  await page.goto("/account");

  await expect(page).toHaveURL(/\/auth\/signup\/company\?/);
  expect(returnToOf(page.url())).toBe(`${BASE_URL}/account`);
});

test("事業所状態の取得が 500 で失敗しても、/account から移らない", async ({ page }) => {
  await signedIn(page);
  let failed = 0;
  await page.route("**/api/account/memberships", async (route) => {
    failed++;
    await route.fulfill({ status: 500, json: {} });
  });

  await page.goto("/account");
  await expect.poll(() => failed).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);

  expect(new URL(page.url()).pathname).toBe("/account");
});

test("/account の初回表示で、事業所状態の GET は 1 回", async ({ page }) => {
  await signedIn(page);
  let gets = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().endsWith("/api/account/memberships")) gets++;
  });

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
  await page.waitForTimeout(500);

  expect(gets).toBe(1);
});

test("事業所状態の応答を待つ間は読み込み中の表示を出す", async ({ page }) => {
  await signedIn(page);
  await page.route("**/api/account/memberships", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });

  await page.goto("/account");

  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("heading", { name: "プロフィール" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});

test("/account/members を直接開くとメンバーの一覧を出す", async ({ page }) => {
  await signedIn(page);

  await page.goto("/account/members");

  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByText("e2e-signin@example.com").first()).toBeVisible();
});

test("sidebar で移った後、browser の戻ると進むで画面が切り替わる", async ({ page }) => {
  await signedIn(page);
  await page.goto("/account");
  await page.getByRole("link", { name: "メンバー" }).click();
  await expect(page).toHaveURL(`${BASE_URL}/account/members`);

  await page.goBack();
  await expect(page).toHaveURL(`${BASE_URL}/account`);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`${BASE_URL}/account/members`);
  await expect(page.getByRole("region", { name: "メンバー一覧" })).toBeVisible();
});

test("sidebar の link は表示中の画面だけが aria-current を持つ", async ({ page }) => {
  await signedIn(page);

  await page.goto("/account/members");

  await expect(page.getByRole("link", { name: "メンバー" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "プロフィール" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("session の無い browser で事業所登録を開くと、事業所状態を取得せずにログイン画面へ移る", async ({
  page,
}) => {
  let membershipRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/account/memberships")) membershipRequests++;
  });

  await page.goto(
    `/auth/signup/company?service_name=accounts&redirect_url=${encodeURIComponent(`${BASE_URL}/account`)}`,
  );

  await expect(page).toHaveURL(/\/auth\/\?service_name=accounts&redirect_url=/);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
  expect(membershipRequests).toBe(0);
});

test("所属のある user が事業所登録を開くと、redirect_url へ移る", async ({ page }) => {
  await signedIn(page);

  await page.goto(
    `/auth/signup/company?service_name=accounts&redirect_url=${encodeURIComponent(`${BASE_URL}/account`)}`,
  );

  await expect(page).toHaveURL(`${BASE_URL}/account`);
});

test("所属のある user が許可されていない redirect_url で事業所登録を開くと、/account へ移る", async ({
  page,
}) => {
  await signedIn(page);

  await page.goto(
    `/auth/signup/company?service_name=accounts&redirect_url=${encodeURIComponent(EVIL_URL)}`,
  );

  await expect(page).toHaveURL(`${BASE_URL}/account`);
});

test("事業所登録の「別のアカウントでログインする」は、末尾スラッシュ無しのログイン画面に移る", async ({
  page,
}) => {
  await signInWithMagicLink(page, `e2e-newbie-${Date.now()}@example.com`);
  await expect(page.getByText("事業所を登録してください")).toBeVisible();

  await page.getByRole("button", { name: "別のアカウントでログインする" }).click();

  await expectSignInLanding(page);
});

test("事業所登録の「別のアカウントでログインする」は、ログアウトに失敗すると失敗の文言を出して事業所登録に留まる", async ({
  page,
}) => {
  await signInWithMagicLink(page, `e2e-newbie-${Date.now()}@example.com`);
  await expect(page.getByText("事業所を登録してください")).toBeVisible();
  await page.route(/\/api\/auth\/sign-out$/, (route) => route.fulfill({ status: 500, json: {} }));

  await page.getByRole("button", { name: "別のアカウントでログインする" }).click();

  await expect(page.getByText("ログアウトに失敗しました。")).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/signup\/company/);
});
