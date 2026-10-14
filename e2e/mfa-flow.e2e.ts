import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, test, type Page } from "@playwright/test";
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
} from "../src/mfa/totp/totp-parameters";
import { SIGN_IN_LANDING_PATH } from "../web/src/auth/auth-redirect";
import { reseedFixture, signInWithMagicLink, watchMainFrameNavigations } from "./helpers";

const MFA_EMAIL = "e2e-mfa@example.com";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(() => {
  reseedFixture("mfa");
});

const decodeTotpSecret = (encoded: string): string =>
  new TextDecoder().decode(base32.decode(encoded));

const secretFromTotpUri = (totpUri: string): string => {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`otpauth URI に secret が無い: ${totpUri}`);
  return decodeTotpSecret(encoded);
};

const totpCode = (secret: string, stepOffset = 0): Promise<string> => {
  const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: TOTP_DIGITS });
  if (stepOffset === 0) return otp.totp();
  return otp.hotp(Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset);
};

const wrongTotpCode = async (secret: string): Promise<string> => {
  const acceptedOffsets = Array.from(
    { length: TOTP_WINDOW_STEPS * 2 + 1 },
    (_, i) => i - TOTP_WINDOW_STEPS,
  );
  const accepted = await Promise.all(acceptedOffsets.map((offset) => totpCode(secret, offset)));
  for (let candidate = 0; candidate < 1000; candidate++) {
    const code = String(candidate).padStart(TOTP_DIGITS, "0");
    if (!accepted.includes(code)) return code;
  }
  throw new Error("検証窓の外にある誤コードを作れなかった");
};

const PREVIOUS_STEP_LEAVING_CURRENT_UNUSED = -1;

type EnabledMfa = { secret: string; recoveryCodes: string[] };

const enableMfaViaApi = async (page: Page): Promise<EnabledMfa> => {
  const enrolled = await page.request.post("/api/account/mfa/enroll", {
    headers: { "content-type": "application/json" },
  });
  expect(enrolled.status()).toBe(200);
  const enrollment = (await enrolled.json()) as {
    totp_uri: string;
    recovery_codes: string[];
    enrollment_id: string;
  };

  const secret = secretFromTotpUri(enrollment.totp_uri);
  const activated = await page.request.post("/api/account/mfa/activate", {
    data: {
      code: await totpCode(secret, PREVIOUS_STEP_LEAVING_CURRENT_UNUSED),
      enrollment_id: enrollment.enrollment_id,
    },
  });
  expect(activated.status()).toBe(200);

  return { secret, recoveryCodes: enrollment.recovery_codes };
};

const signOutAndReachChallenge = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/auth\//);

  await signInWithMagicLink(page, MFA_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa/);
};

const mfaRow = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: "多要素認証 (MFA)" });

const challengeCodeInput = (page: Page) => page.locator("#mfa-challenge-code");

test("QA-H-10 セキュリティページの MFA 行は有効化の前後で Badge と残数が変わる", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await page.goto("/account/security");

  const row = mfaRow(page);
  await expect(row.getByText("無効", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "有効にする" })).toBeVisible();
  await expect(row.getByText("リカバリーコードの残り")).toHaveCount(0);

  const { recoveryCodes } = await enableMfaViaApi(page);
  await page.reload();

  await expect(row.getByText("有効", { exact: true })).toBeVisible();
  await expect(row.getByText(`リカバリーコードの残り: ${recoveryCodes.length} 個`)).toBeVisible();
  await expect(row.getByRole("button", { name: "無効にする" })).toBeVisible();
});

test("AC-016 無効化ダイアログは error を表示し、閉じると入力状態を reset する", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  const { secret } = await enableMfaViaApi(page);
  await page.goto("/account/security");

  const row = mfaRow(page);
  await row.getByRole("button", { name: "無効にする" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("#mfa-disable-code").fill(await wrongTotpCode(secret));
  await dialog.getByRole("button", { name: "無効にする" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("入力されたコードが正しくありません。");

  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await row.getByRole("button", { name: "無効にする" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator("#mfa-disable-code")).toHaveValue("");
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await dialog.locator("#mfa-disable-code").fill(await totpCode(secret));
  await dialog.getByRole("button", { name: "無効にする" }).click();
  await expect(page.getByText("多要素認証 (MFA) を無効にしました。")).toBeVisible();
  await expect(row.getByText("無効", { exact: true })).toBeVisible();
});

test("QA-H-11 有効化ダイアログは QR・確認コード・リカバリーコードの 3 ステップを順に見せる", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await page.goto("/account/security");
  await expect(mfaRow(page).getByRole("button", { name: "有効にする" })).toBeVisible();
  const navigations = watchMainFrameNavigations(page);
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "認証アプリで読み取る QR コード" })).toBeVisible();
  const secret = decodeTotpSecret((await dialog.locator('p[translate="no"]').innerText()).trim());
  await expect(dialog.getByRole("button", { name: "secret をコピー" })).toBeVisible();

  await dialog.getByRole("button", { name: "次へ" }).click();
  await dialog.locator("#mfa-enroll-code").fill(await totpCode(secret));
  await dialog.getByRole("button", { name: "有効にする" }).click();

  await expect(dialog.getByText("このダイアログを閉じると再表示できません")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "リカバリーコードをコピー" })).toBeVisible();
  const shownRecoveryCodes = await dialog.getByRole("listitem").count();
  expect(shownRecoveryCodes).toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "控えたので閉じる" }).click();
  await expect(page.getByText("多要素認証 (MFA) を有効にしました。")).toBeVisible();
  await expect(
    mfaRow(page).getByText(`リカバリーコードの残り: ${shownRecoveryCodes} 個`),
  ).toBeVisible();
  await expect(mfaRow(page).getByText("有効", { exact: true })).toBeVisible();
  expect(navigations.count()).toBe(0);
});

test("QA-H-04 有効化ダイアログを閉じて開き直しても同じ secret のまま再登録しない", async ({
  page,
}) => {
  let enrollCalls = 0;
  await page.route("**/api/account/mfa/enroll", async (route) => {
    enrollCalls++;
    await route.continue();
  });

  await signInWithMagicLink(page, MFA_EMAIL);
  await page.goto("/account/security");
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();

  const dialog = page.getByRole("dialog");
  const firstSecret = (await dialog.locator('p[translate="no"]').innerText()).trim();
  expect(firstSecret.length).toBeGreaterThan(1);
  expect(firstSecret).not.toBe("—");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  const secondSecret = (await dialog.locator('p[translate="no"]').innerText()).trim();

  expect(secondSecret).toBe(firstSecret);
  expect(enrollCalls).toBe(1);
});

test("QA-M-07 チャレンジ画面のコード入力欄は種別に応じた入力支援属性と aria を持つ", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await enableMfaViaApi(page);
  await signOutAndReachChallenge(page);

  const input = challengeCodeInput(page);
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveAttribute("aria-label", "確認コード");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(input).toHaveAttribute("aria-describedby", "mfa-challenge-code-hint");

  await page.getByRole("button", { name: "リカバリーコードを使う" }).click();
  await expect(input).toHaveAttribute("inputmode", "text");
  await expect(input).toHaveAttribute("aria-label", "リカバリーコード");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
});

test("QA-E-10 cookie 無しで /auth/mfa を直接開くと期限切れ案内だけを出す", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/auth/mfa");

  await expect(page.getByText("セッションの有効期限が切れました")).toBeVisible();
  await expect(page.getByRole("link", { name: "ログイン画面へ" })).toBeVisible();

  await expect(challengeCodeInput(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ログインを続ける" })).toHaveCount(0);
});

test("AC-006 verify が直接 challenge_expired を返したら入力を閉じる", async ({ page }) => {
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    await route.fulfill({ status: 401, json: { _tag: "ChallengeExpired" } });
  });

  await page.goto("/auth/mfa");
  await challengeCodeInput(page).fill("123456");
  await page.getByRole("button", { name: "ログインを続ける" }).click();

  await expect(page.getByText("セッションの有効期限が切れました")).toBeVisible();
  await expect(page.getByRole("link", { name: "ログイン画面へ" })).toBeVisible();
  await expect(challengeCodeInput(page)).toHaveCount(0);
  await expect(page.locator("#mfa-challenge-code-error")).toHaveCount(0);
});

test("AC-003/025 初期 GET が失敗しても一度の観測で入力を許す", async ({ page }) => {
  let getCalls = 0;
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.abort();
      return;
    }
    getCalls++;
    await route.fulfill({ status: 503, json: {} });
  });

  await page.goto("/auth/mfa");
  await expect(challengeCodeInput(page)).toBeVisible();
  await page.waitForTimeout(200);

  expect(getCalls).toBe(1);
  await expect(page.getByText("セッションの有効期限が切れました")).toHaveCount(0);
});

test("AC-023 初期観測中は status だけを表示して入力を隠す", async ({ page }) => {
  let releaseObservation: (() => void) | undefined;
  const observationPending = new Promise<void>((resolve) => {
    releaseObservation = resolve;
  });
  await page.route("**/api/mfa/challenge", async (route) => {
    await observationPending;
    await route.fulfill({ json: { pending: true } });
  });

  await page.goto("/auth/mfa");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(challengeCodeInput(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ログインを続ける" })).toHaveCount(0);

  releaseObservation?.();
  await expect(challengeCodeInput(page)).toBeVisible();
});

test("AC-004 Abort 済みの古い GET は新しい画面状態を上書きしない", async ({ page }) => {
  let getCalls = 0;
  let releaseFirst: (() => void) | undefined;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route("**/api/mfa/challenge", async (route) => {
    getCalls++;
    if (getCalls === 1) {
      await firstPending;
      await route.fulfill({ json: { pending: false } }).catch(() => undefined);
      return;
    }
    await route.fulfill({ json: { pending: true } });
  });

  await page.goto("/auth/mfa");
  await expect(page.getByRole("status")).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/auth/error");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.evaluate(() => {
    history.pushState({}, "", "/auth/mfa");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(challengeCodeInput(page)).toBeVisible();

  releaseFirst?.();
  await page.waitForTimeout(200);
  expect(getCalls).toBe(2);
  await expect(challengeCodeInput(page)).toBeVisible();
  await expect(page.getByText("セッションの有効期限が切れました")).toHaveCount(0);
});

test("AC-013/024 verify 中は操作を止め、同期二重 submit でも POST は一回", async ({ page }) => {
  let postCalls = 0;
  let releaseVerify: (() => void) | undefined;
  const verifyPending = new Promise<void>((resolve) => {
    releaseVerify = resolve;
  });
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    postCalls++;
    await verifyPending;
    await route.fulfill({ status: 400, json: { _tag: "InvalidCode" } });
  });

  await page.goto("/auth/mfa");
  await challengeCodeInput(page).fill("123456");
  await page.locator("form").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await expect.poll(() => postCalls).toBe(1);
  await expect(challengeCodeInput(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "ログインを続ける" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "リカバリーコードを使う" })).toBeDisabled();
  await expect(page.locator("#mfa-challenge-code-error")).toHaveCount(0);

  releaseVerify?.();
  await expect(page.locator("#mfa-challenge-code-error")).toHaveText(
    "入力されたコードが正しくありません。",
  );
  expect(postCalls).toBe(1);

  await page.getByRole("button", { name: "リカバリーコードを使う" }).click();
  await expect(page.locator("#mfa-challenge-code-error")).toHaveCount(0);
  await expect(challengeCodeInput(page)).toHaveValue("");
  await expect(challengeCodeInput(page)).toHaveAttribute("inputmode", "text");
});

test("AC-014 unmount 後も送信済み POST は完了し、遅い成功で遷移しない", async ({ page }) => {
  let postStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    postStarted = resolve;
  });
  let releaseVerify: (() => void) | undefined;
  const verifyPending = new Promise<void>((resolve) => {
    releaseVerify = resolve;
  });
  let postCompleted = false;
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    postStarted?.();
    await verifyPending;
    await route.fulfill({ json: { redirect_url: "/account" } });
    postCompleted = true;
  });

  await page.goto("/auth/mfa");
  await challengeCodeInput(page).fill("123456");
  await page.getByRole("button", { name: "ログインを続ける" }).click();
  await started;
  await page.evaluate(() => {
    history.pushState({}, "", "/auth/error");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/auth\/error$/);
  await expect(challengeCodeInput(page)).toHaveCount(0);

  releaseVerify?.();
  await expect.poll(() => postCompleted).toBe(true);
  await expect(page).toHaveURL(/\/auth\/error$/);
  await expect(challengeCodeInput(page)).toHaveCount(0);
});

const mockChallenge = (page: Page, verify: { status: number; json?: unknown }) =>
  page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    await route.fulfill(verify);
  });

const submitChallengeCode = async (page: Page) => {
  await challengeCodeInput(page).fill("123456");
  await page.getByRole("button", { name: "ログインを続ける" }).click();
};

test("verify が空の redirect_url を返したら、遷移せずに既定の失敗の文言を出す", async ({
  page,
}) => {
  await mockChallenge(page, { status: 200, json: { redirect_url: "" } });
  await page.goto("/auth/mfa");

  await submitChallengeCode(page);

  await expect(page.locator("#mfa-challenge-code-error")).toHaveText(
    "処理に失敗しました。しばらく待ってからもう一度お試しください。",
  );
  expect(new URL(page.url()).pathname).toBe("/auth/mfa");
});

test("verify が本文の無い 400 を返したら、既定の失敗の文言を出す", async ({ page }) => {
  await mockChallenge(page, { status: 400 });
  await page.goto("/auth/mfa");

  await submitChallengeCode(page);

  await expect(page.locator("#mfa-challenge-code-error")).toHaveText(
    "処理に失敗しました。しばらく待ってからもう一度お試しください。",
  );
});

test("verify が試行枠の 429 (RateLimited) を受けると、回数の上限の文言を出す", async ({ page }) => {
  await mockChallenge(page, { status: 429, json: { _tag: "RateLimited" } });
  await page.goto("/auth/mfa");

  await submitChallengeCode(page);

  await expect(page.locator("#mfa-challenge-code-error")).toHaveText(
    "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  );
});

test("「ログインをやり直す」は末尾スラッシュ無しのログイン画面を指す", async ({ page }) => {
  await mockChallenge(page, { status: 400, json: { _tag: "InvalidCode" } });
  await page.goto("/auth/mfa");

  const href = await page.getByRole("link", { name: "ログインをやり直す" }).getAttribute("href");

  expect(href?.startsWith(`${SIGN_IN_LANDING_PATH}&redirect_url=`)).toBe(true);
});

test("AC-033 空の code は verify を呼ばない", async ({ page }) => {
  let postCalls = 0;
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    postCalls++;
    await route.abort();
  });

  await page.goto("/auth/mfa");
  await expect(page.getByRole("button", { name: "ログインを続ける" })).toBeDisabled();
  await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(100);

  expect(postCalls).toBe(0);
});

test("MFA 有効化後のログインはチャレンジ画面を挟み、通過すると元の遷移先に着地する", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await expect(page).toHaveURL(/\/account/);
  const { secret } = await enableMfaViaApi(page);

  await signOutAndReachChallenge(page);
  await expect(page.getByText("ログインを完了するには、追加の確認が必要です")).toBeVisible();

  await challengeCodeInput(page).fill(await totpCode(secret));
  await page.getByRole("button", { name: "ログインを続ける" }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "プロフィール" })).toBeVisible();
});

test("リカバリーコードでもチャレンジを通過でき、使った 1 本だけ残数が減る", async ({ page }) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  const { recoveryCodes } = await enableMfaViaApi(page);

  await signOutAndReachChallenge(page);
  await page.getByRole("button", { name: "リカバリーコードを使う" }).click();
  await challengeCodeInput(page).fill(recoveryCodes[0]);
  await page.getByRole("button", { name: "ログインを続ける" }).click();

  await expect(page).toHaveURL(/\/account$/);

  await page.goto("/account/security");
  await expect(
    mfaRow(page).getByText(`リカバリーコードの残り: ${recoveryCodes.length - 1} 個`),
  ).toBeVisible();
});

test("誤ったコードはチャレンジ画面に留まり、inline エラーを出す", async ({ page }) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  const { secret } = await enableMfaViaApi(page);

  await signOutAndReachChallenge(page);
  await challengeCodeInput(page).fill(await wrongTotpCode(secret));
  await page.getByRole("button", { name: "ログインを続ける" }).click();

  const inlineError = page.locator("#mfa-challenge-code-error");
  await expect(inlineError).toHaveText("入力されたコードが正しくありません。");
  await expect(inlineError).toHaveClass(/text-destructive/);
  await expect(challengeCodeInput(page)).toHaveAttribute("aria-invalid", "true");
  await expect(challengeCodeInput(page)).toHaveAttribute(
    "aria-describedby",
    "mfa-challenge-code-hint mfa-challenge-code-error",
  );
  await expect(page).toHaveURL(/\/auth\/mfa/);

  await expect(page.locator("body")).not.toContainText(/invalid[_-]?code|two[_-]?factor/i);
});

test("無効化が試行枠の 429 (RateLimited) を受けると、回数の上限の文言を出す", async ({ page }) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await enableMfaViaApi(page);
  let limitedRequests = 0;
  await page.route("**/api/account/mfa/disable", async (route) => {
    limitedRequests++;
    await route.fulfill({ status: 429, json: { _tag: "RateLimited" } });
  });
  await page.goto("/account/security");

  await mfaRow(page).getByRole("button", { name: "無効にする" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#mfa-disable-code").fill("123456");
  await dialog.getByRole("button", { name: "無効にする" }).click();

  await expect(dialog.getByRole("alert")).toHaveText(
    "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  );
  expect(limitedRequests).toBe(1);
});

test("MFA の状態の取得が失敗すると、取得できなかった旨を出す", async ({ page }) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  let failedRequests = 0;
  await page.route("**/api/account/mfa", async (route) => {
    failedRequests++;
    await route.fulfill({ status: 500, body: "" });
  });

  await page.goto("/account/security");

  await expect(page.getByRole("alert")).toHaveText(
    "多要素認証 (MFA) の設定状態を取得できませんでした。",
  );
  expect(failedRequests).toBeGreaterThanOrEqual(1);
});

test("登録が AlreadyEnabled で失敗すると、有効化ダイアログに再読み込みの案内を出す", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await page.route("**/api/account/mfa/enroll", async (route) => {
    await route.fulfill({ status: 409, json: { _tag: "AlreadyEnabled" } });
  });
  await page.goto("/account/security");

  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();

  await expect(
    page
      .getByRole("dialog")
      .getByText("多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。"),
  ).toBeVisible();
});

test("有効化が EnrollmentChanged で失敗した後に開き直すと、登録をやり直す", async ({ page }) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  let enrollRequests = 0;
  await page.route("**/api/account/mfa/enroll", async (route) => {
    enrollRequests++;
    await route.continue();
  });
  await page.route("**/api/account/mfa/activate", async (route) => {
    await route.fulfill({ status: 409, json: { _tag: "EnrollmentChanged" } });
  });
  await page.goto("/account/security");

  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "次へ" }).click();
  await dialog.locator("#mfa-enroll-code").fill("123456");
  await dialog.getByRole("button", { name: "有効にする" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "登録情報が更新されました。もう一度登録を開始してください。",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "次へ" })).toBeVisible();
  expect(enrollRequests).toBe(2);
});
