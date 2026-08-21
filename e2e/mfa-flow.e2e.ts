import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, test, type Page } from "@playwright/test";
import { reseedFixture, signInWithMagicLink } from "./helpers";

// 多要素認証 (MFA) のブラウザ実機スモーク。use-case / handler テストでは組み立てられない
// 「一次認証 → チャレンジ画面 → 元の遷移先」の連鎖と、画面にしか存在しない状態 (一度きり表示の
// リカバリーコード / 入力支援属性) を固定する。設計詳細: docs/adr/0013-mfa-totp-challenge.md

const MFA_EMAIL = "e2e-mfa@example.com";

// 1 test に magic link ログイン 2 回 (有効化前 + チャレンジ) と fixture 再生成が入り、既定の
// 30 秒に収まらない。
test.describe.configure({ timeout: 90_000 });

test.beforeEach(() => {
  // mfa ユーザーは本 spec が MFA 状態ごと消費する (消費型 fixture)
  reseedFixture("mfa");
});

// 認証アプリの代わりにコードを作る一式。src/mfa/__tests__/helpers.ts の同名関数は再利用せず
// 書き下ろす — あちらは db / redis client を道連れに import するため、spec プロセスに pg Pool を
// 開くことになる (biome の e2e override が禁じている理由そのもの)。生成そのものは本番と同じ
// @better-auth/utils に委ねる。
// 刻みは src/auth.ts の totpOptions と同値。プラグインに検証窓の option は無く、窓の広さ
// (前後 1 step) は @better-auth/utils の既定にしか書かれていないため、テストが刻みを自分で持つ。
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;

// otpauth URI と画面が見せる secret は base32 表現で、createOTP が要求するのは復号後の値。
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

// 固定の誤コードは検証窓 (前後 1 step) に偶然一致して間欠的に緑になる。窓に入る 3 本を実際に
// 生成して避ける。
const wrongTotpCode = async (secret: string): Promise<string> => {
  const accepted = await Promise.all([-1, 0, 1].map((offset) => totpCode(secret, offset)));
  for (let candidate = 0; candidate < 1000; candidate++) {
    const code = String(candidate).padStart(TOTP_DIGITS, "0");
    if (!accepted.includes(code)) return code;
  }
  throw new Error("検証窓の外にある誤コードを作れなかった");
};

type EnabledMfa = { secret: string; recoveryCodes: string[] };

// 画面からの有効化動線は QA-H-11 が受け持つ。他の test は「MFA 有効な user」を前提条件として
// だけ必要とするので、SPA と同じ API で用意する。page.request は browser context の cookie を
// 共有するため、activate が rotate したセッションはそのまま画面側の続きに引き継がれる。
const enableMfaViaApi = async (page: Page): Promise<EnabledMfa> => {
  const enrolled = await page.request.post("/api/account/mfa/enroll");
  expect(enrolled.status()).toBe(200);
  const enrollment = (await enrolled.json()) as {
    totp_uri: string;
    recovery_codes: string[];
    enrollment_id: string;
  };

  const secret = secretFromTotpUri(enrollment.totp_uri);
  // enrollment_id を送るのは SPA と同じ識別子照合つきの activate 経路 (ID 省略は旧タブ互換用で
  // 第 2 段階に削除予定 — e2e が互換経路だけを踏むと本経路が end-to-end 無検証になる)。
  const activated = await page.request.post("/api/account/mfa/activate", {
    data: { code: await totpCode(secret), enrollment_id: enrollment.enrollment_id },
  });
  expect(activated.status()).toBe(200);

  return { secret, recoveryCodes: enrollment.recovery_codes };
};

// 有効化しても手元のセッションは rotate されて生き続ける (チャレンジが挟まるのは一次認証の
// 直後だけ) ため、チャレンジ画面へはログアウトしてログインし直して到達する。
const signOutAndReachChallenge = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/auth\//);

  await signInWithMagicLink(page, MFA_EMAIL);
  await expect(page).toHaveURL(/\/auth\/mfa/);
};

// トーストは main の外に出るため、通知文言に含まれる語で行を誤判定しないよう main に絞る。
const mfaRow = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: "多要素認証 (MFA)" });

const challengeCodeInput = (page: Page) => page.locator("#mfa-challenge-code");

test("QA-H-10 セキュリティページの MFA 行は有効化の前後で Badge と残数が変わる", async ({
  page,
}) => {
  await signInWithMagicLink(page, MFA_EMAIL);
  await page.goto("/account/security");

  const row = mfaRow(page);
  // Badge の文字列は「無効にする」ボタンにも含まれるため、exact でないと行の状態を判定できない
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
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "認証アプリで読み取る QR コード" })).toBeVisible();
  // 手入力用 secret は QR を読めない端末の唯一の登録手段。翻訳による書き換えを避ける
  // translate="no" がこのステップで唯一の目印なので、そこから認証アプリの代わりを務める。
  const secret = decodeTotpSecret((await dialog.locator('p[translate="no"]').innerText()).trim());
  await expect(dialog.getByRole("button", { name: "secret をコピー" })).toBeVisible();

  await dialog.getByRole("button", { name: "次へ" }).click();
  await dialog.locator("#mfa-enroll-code").fill(await totpCode(secret));
  await dialog.getByRole("button", { name: "有効にする" }).click();

  await expect(dialog.getByText("このダイアログを閉じると再表示できません")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "リカバリーコードをコピー" })).toBeVisible();
  const shownRecoveryCodes = await dialog.getByRole("listitem").count();
  expect(shownRecoveryCodes).toBeGreaterThan(0);

  // 状態の再取得と成功トーストはダイアログを閉じた時に走る (途中離脱では有効化を確定させない)
  await dialog.getByRole("button", { name: "控えたので閉じる" }).click();
  await expect(page.getByText("多要素認証 (MFA) を有効にしました。")).toBeVisible();
  await expect(
    mfaRow(page).getByText(`リカバリーコードの残り: ${shownRecoveryCodes} 個`),
  ).toBeVisible();
});

test("QA-H-04 有効化ダイアログを閉じて開き直しても同じ secret のまま再登録しない", async ({
  page,
}) => {
  // 登録途中の再 enroll はサーバが同じ登録内容を replay する (正本: docs/adr/0013 §8) ため
  // secret は変わらない前提。この test が固定するのは client cache が余分な enroll 往復を
  // 発生させないことと、開き直しでも同じ secret が表示されること。reload / 別タブ経路の
  // 観測は手動 QA の担当。
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
  // readTotpSecret が失敗すると placeholder "—" が描画され、"—" === "—" で空疎に通ってしまう
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

  // 通らないコードを打てる形で出すと「入力したのに進めない」袋小路になる
  await expect(challengeCodeInput(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ログインを続ける" })).toHaveCount(0);
});

test("AC-006 verify が直接 challenge_expired を返したら入力を閉じる", async ({ page }) => {
  await page.route("**/api/mfa/challenge**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { pending: true } });
      return;
    }
    await route.fulfill({ status: 401, json: { error: "challenge_expired" } });
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
    await route.fulfill({ status: 400, json: { error: "invalid_code" } });
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
  // POST を解放する前に画面離脱が完了したことを固定し、未 mount 中の応答だけを検証する。
  await expect(page).toHaveURL(/\/auth\/error$/);
  await expect(challengeCodeInput(page)).toHaveCount(0);

  releaseVerify?.();
  await expect.poll(() => postCompleted).toBe(true);
  await expect(page).toHaveURL(/\/auth\/error$/);
  await expect(challengeCodeInput(page)).toHaveCount(0);
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
  // 期限切れ表示ではなく保留中のチャレンジとして描画されていること (着地しただけでは区別できない)
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

  // 文言解決 (use-mfa-code-entry の describeMfaChallengeError) を素通りして、プラグインの生の
  // エラーコードが画面に出ていないこと
  await expect(page.locator("body")).not.toContainText(/invalid[_-]?code|two[_-]?factor/i);
});
