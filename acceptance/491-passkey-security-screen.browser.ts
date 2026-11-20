// fallow-ignore-file unused-file
import { expect, test } from "@playwright/test";

import {
  addVirtualAuthenticator,
  mfaRow,
  openSecurityScreen,
  passkeyItems,
  passkeyRow,
  registrationControl,
  screenFeedback,
  securityRows,
  settledCreations,
} from "./harness/security-screen";

const RETRY_PROMPT = /もう一度|やり直/;

const USED_PASSKEY = {
  id: "passkey-used",
  created_at: "2026-03-04T03:00:00.000Z",
  last_used_at: "2026-05-06T03:00:00.000Z",
};

const UNUSED_PASSKEY = {
  id: "passkey-unused",
  created_at: "2026-07-08T03:00:00.000Z",
  last_used_at: null,
};

test("確認ありの authenticator でパスキーを登録すると、作成した応答が送られ、一覧が 0 本から 1 本になる", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  const screen = await openSecurityScreen(page, { mfaEnabled: false, passkeys: [], canRegister: true });
  await expect(passkeyRow(page)).toBeVisible();
  expect(await passkeyItems(page).count()).toBe(0);

  await registrationControl(page).click();

  await expect(passkeyItems(page)).toHaveCount(1);
  expect(screen.registrations()).toEqual([
    expect.objectContaining({ type: "public-key", id: expect.any(String) }),
  ]);
});

test("セキュリティの画面に「実装予定」も英字の Passkey も無く、「パスキー」の行が出る", async ({
  page,
}) => {
  await openSecurityScreen(page, { passkeys: [USED_PASSKEY], canRegister: true });
  await expect(passkeyRow(page)).toBeVisible();

  expect(await page.getByText("実装予定").count()).toBe(0);
  expect(await page.getByText("Passkey").count()).toBe(0);
});

test("一覧の各項目に登録日と最後に使った日が出て、使っていないパスキーは「未使用」と出る", async ({
  page,
}) => {
  await openSecurityScreen(page, { passkeys: [USED_PASSKEY, UNUSED_PASSKEY], canRegister: true });
  await expect(passkeyItems(page)).toHaveCount(2);

  const [used, unused] = await passkeyItems(page).allInnerTexts();
  expect(used).toContain("登録日");
  expect(used).toMatch(/2026\D+0?3\D+0?4/);
  expect(used).toContain("最後に使った日");
  expect(used).toMatch(/2026\D+0?5\D+0?6/);
  expect(unused).toContain("登録日");
  expect(unused).toMatch(/2026\D+0?7\D+0?8/);
  expect(unused).toContain("最後に使った日");
  expect(unused).toContain("未使用");
});

test("パスキーが 0 本で登録できる時は、パスキーの行に無いことを述べる表示が出る", async ({
  page,
}) => {
  await openSecurityScreen(page, { passkeys: [], canRegister: true });

  await expect(passkeyRow(page)).toContainText(/ありません|無い|ない|未登録/);
});

test("確認を拒んで取り消してから登録し直すと、一覧・送信の回数・通知と alert は、取り消さずに 1 回登録した時と同じになる", async ({
  browser,
}) => {
  const observe = async (cancelFirst: boolean) => {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });
    const page = await context.newPage();
    const authenticator = await addVirtualAuthenticator(page, { userVerified: !cancelFirst });
    const screen = await openSecurityScreen(page, { passkeys: [], canRegister: true });
    if (cancelFirst) {
      await registrationControl(page).click();
      await expect.poll(() => settledCreations(page)).toBe(1);
      await authenticator.verifyUser(true);
    }
    await registrationControl(page).click();
    await expect(passkeyItems(page)).toHaveCount(1);
    await expect.poll(() => settledCreations(page)).toBe(cancelFirst ? 2 : 1);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const observed = {
      items: await passkeyItems(page).count(),
      registrations: screen.registrations().length,
      feedback: await screenFeedback(page),
    };
    await context.close();
    return observed;
  };

  const cancelledThenRegistered = await observe(true);
  const registeredOnce = await observe(false);

  expect(cancelledThenRegistered).toEqual(registeredOnce);
});

test("browser の作成が options の示す時間を過ぎて失敗すると、やり直しを促す文言が出る", async ({
  page,
}) => {
  await addVirtualAuthenticator(page, { presence: false });
  await openSecurityScreen(page, { passkeys: [], canRegister: true, ceremonyTimeoutMs: 2_000 });

  await registrationControl(page).click();

  await expect(page.getByText(RETRY_PROMPT)).toBeVisible();
});

test("登録の API が時間切れで拒んだ時は、browser の作成が時間を過ぎた時と同じやり直しを促す文言が出る", async ({
  browser,
}) => {
  const retryPromptAfter = async (scenario: "browser-timeout" | "server-rejected") => {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });
    const page = await context.newPage();
    await addVirtualAuthenticator(page, { presence: scenario !== "browser-timeout" });
    await openSecurityScreen(page, {
      passkeys: [],
      canRegister: true,
      ceremonyTimeoutMs: scenario === "browser-timeout" ? 2_000 : undefined,
      registrationRejected: scenario === "server-rejected",
    });
    await registrationControl(page).click();
    const prompt = page.getByText(RETRY_PROMPT).first();
    await expect(prompt).toBeVisible();
    const text = await prompt.innerText();
    await context.close();
    return text;
  };

  expect(await retryPromptAfter("server-rejected")).toBe(await retryPromptAfter("browser-timeout"));
});

test("PublicKeyCredential の無い browser では、一覧は出るが、パスキーの行に登録の操作が出ない", async ({
  page,
}) => {
  await openSecurityScreen(page, {
    passkeys: [USED_PASSKEY],
    canRegister: true,
    withoutWebAuthn: true,
  });
  await expect(passkeyItems(page)).toHaveCount(1);

  expect(await registrationControl(page).count()).toBe(0);
});

test("MFA が有効な user には、一覧は出るが、パスキーの行に登録の操作が出ない", async ({ page }) => {
  await openSecurityScreen(page, { mfaEnabled: true, passkeys: [USED_PASSKEY], canRegister: true });
  await expect(passkeyItems(page)).toHaveCount(1);

  expect(await registrationControl(page).count()).toBe(0);
});

test("パスキーが 0 本で登録できない時は、セキュリティの画面の一覧が MFA の行だけになる", async ({
  page,
}) => {
  await openSecurityScreen(page, {
    passkeys: [],
    canRegister: false,
    mfaAnsweredAfterPasskeyList: true,
  });
  await expect(mfaRow(page)).toBeVisible();

  await expect(securityRows(page)).toHaveCount(1);
});

test("パスキーが 1 本以上で登録できない時は、一覧は出るが、パスキーの行に登録の操作が出ない", async ({
  page,
}) => {
  await openSecurityScreen(page, { passkeys: [USED_PASSKEY], canRegister: false });
  await expect(passkeyItems(page)).toHaveCount(1);

  expect(await registrationControl(page).count()).toBe(0);
});
