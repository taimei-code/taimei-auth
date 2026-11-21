import { type Browser, expect, type Page, test } from "@playwright/test";
import { declaredFailure, routeEndpoint } from "./contract-mock";
import {
  addVirtualAuthenticator,
  BASE_URL,
  featureFlags,
  mfaRow,
  PASSKEY_EMAIL,
  reseedFixture,
  signInWithMagicLink,
} from "./helpers";

const PASSKEY = "passkey";
const RETRY_PROMPT = /もう一度|やり直/;
const BROWSER_CEREMONY_TIMEOUT_MS = 2_000;

const USED_PASSKEY = {
  id: "passkey-used",
  created_at: "2026-03-04T03:00:00.000Z",
  last_used_at: "2026-05-06T03:00:00.000Z",
};

const recordScreenFeedback = () => {
  const log: string[] = [];
  const snapshot = () =>
    [
      ...Array.from(
        document.querySelectorAll('[aria-label="通知"]'),
        (node) => node.textContent ?? "",
      ),
      ...Array.from(document.querySelectorAll('[role="alert"]'), (node) => node.textContent ?? ""),
    ]
      .map((text) => text.trim())
      .filter((text) => text !== "")
      .join(" | ");
  const observe = () => {
    const current = snapshot();
    if (current !== "" && log.at(-1) !== current) {
      log.push(current);
    }
  };
  Object.assign(window, { __screenFeedback: log });
  new MutationObserver(observe).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
};

const countSettledCreations = () => {
  const credentials = navigator.credentials;
  const create = credentials.create.bind(credentials);
  const state = { settled: 0 };
  Object.assign(window, { __settledCreations: state });
  credentials.create = (options) =>
    create(options).finally(() => {
      state.settled += 1;
    });
};

const removeWebAuthn = () => {
  Reflect.deleteProperty(window, "PublicKeyCredential");
};

const settledCreations = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { __settledCreations: { settled: number } }).__settledCreations.settled,
  );

const screenFeedback = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __screenFeedback: string[] }).__screenFeedback]);

const securityRows = (page: Page) => page.getByRole("main").getByRole("listitem");

const passkeyRow = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByText("パスキー", { exact: true }) });

const registerButton = (page: Page) => passkeyRow(page).getByRole("button", { name: "登録する" });

const passkeyItems = (page: Page) => passkeyRow(page).getByRole("listitem");

const newJapanesePage = async (browser: Browser) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    timezoneId: "Asia/Tokyo",
    locale: "ja-JP",
  });
  return { context, page: await context.newPage() };
};

const shortenBrowserCeremony = (page: Page) =>
  routeEndpoint(page, "passkey.registrationOptions", async (route) => {
    const response = await route.fetch();
    const options = (await response.json()) as object;
    await route.fulfill({
      response,
      json: { ...options, timeout: BROWSER_CEREMONY_TIMEOUT_MS },
    });
  });

const openSecurity = async (page: Page) => {
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(passkeyRow(page)).toBeVisible();
};

test.beforeEach(() => reseedFixture("passkey"));

test.afterEach(({ request }) => featureFlags(request).on(PASSKEY));

test("生体か PIN の確認ありの仮想の authenticator で登録すると、一覧に未使用のパスキーが 1 行増える", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await openSecurity(page);
  await expect(passkeyRow(page)).toContainText("登録したパスキーはありません");

  await registerButton(page).click();

  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
  await expect(passkeyRow(page)).toContainText("未使用");
  await expect(page.getByText("パスキーを登録しました。")).toBeVisible();
});

test("確認を拒んで取り消すと、一覧は変わらず、誤りも出ず、続けて登録できる", async ({ page }) => {
  const authenticator = await addVirtualAuthenticator(page, { userVerified: false });
  await openSecurity(page);

  const options = page.waitForResponse("**/api/account/passkeys/registration-options");
  await registerButton(page).click();
  await options;
  await expect(registerButton(page)).toBeEnabled();
  expect(await page.getByRole("alert").count()).toBe(0);
  expect(await passkeyRow(page).getByRole("listitem").count()).toBe(0);

  await authenticator.verifyUser();
  await registerButton(page).click();
  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
});

test("登録の後でフラグを off にすると、一覧は出るが「登録する」は出ない", async ({ page }) => {
  await addVirtualAuthenticator(page);
  await openSecurity(page);
  await registerButton(page).click();
  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);

  await featureFlags(page.request).off(PASSKEY);
  await page.reload();

  await expect(passkeyRow(page).getByRole("listitem")).toHaveCount(1);
  expect(await registerButton(page).count()).toBe(0);
});

test("セキュリティの画面に「実装予定」も英字の Passkey も無く、「パスキー」の行が出る", async ({
  page,
}) => {
  await openSecurity(page);

  expect(await page.getByText("実装予定").count()).toBe(0);
  expect(await page.getByText("Passkey", { exact: true }).count()).toBe(0);
});

test("確認を拒んで取り消してから登録し直すと、一覧・送信の回数・通知と alert は、取り消さずに 1 回登録した時と同じになる", async ({
  browser,
}) => {
  test.slow();
  const observe = async (cancelFirst: boolean) => {
    reseedFixture("passkey");
    const { context, page } = await newJapanesePage(browser);
    await page.addInitScript(recordScreenFeedback);
    await page.addInitScript(countSettledCreations);
    const registrations: unknown[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/account/passkeys"
      ) {
        registrations.push(request.postDataJSON());
      }
    });
    const authenticator = await addVirtualAuthenticator(page, { userVerified: !cancelFirst });
    await openSecurity(page);
    if (cancelFirst) {
      await registerButton(page).click();
      await expect.poll(() => settledCreations(page)).toBe(1);
      await authenticator.verifyUser();
    }
    await registerButton(page).click();
    await expect(passkeyItems(page)).toHaveCount(1);
    await expect.poll(() => settledCreations(page)).toBe(cancelFirst ? 2 : 1);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const observed = {
      items: await passkeyItems(page).count(),
      registrations: registrations.length,
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
  await shortenBrowserCeremony(page);
  await openSecurity(page);

  await registerButton(page).click();

  await expect(page.getByText(RETRY_PROMPT)).toBeVisible();
});

test("登録の API が時間切れで拒んだ時は、browser の作成が時間を過ぎた時と同じやり直しを促す文言が出る", async ({
  browser,
}) => {
  test.slow();
  const retryPromptAfter = async (scenario: "browser-timeout" | "server-rejected") => {
    const { context, page } = await newJapanesePage(browser);
    await addVirtualAuthenticator(page, { presence: scenario !== "browser-timeout" });
    if (scenario === "browser-timeout") {
      await shortenBrowserCeremony(page);
    } else {
      await routeEndpoint(page, "passkey.register", (route) =>
        route.fulfill(declaredFailure("passkey.register", "PasskeyRejected")),
      );
    }
    await openSecurity(page);
    await registerButton(page).click();
    const prompt = page.getByText(RETRY_PROMPT).first();
    await expect(prompt).toBeVisible();
    const text = await prompt.innerText();
    await context.close();
    return text;
  };

  expect(await retryPromptAfter("server-rejected")).toBe(await retryPromptAfter("browser-timeout"));
});

const openSecurityListingUsedPasskey = async (page: Page) => {
  await routeEndpoint(page, "passkey.list", (route) =>
    route.fulfill({ json: { passkeys: [USED_PASSKEY], can_register: true } }),
  );
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(passkeyItems(page)).toHaveCount(1);
};

test("PublicKeyCredential の無い browser では、一覧は出るが、パスキーの行に登録の操作が出ない", async ({
  page,
}) => {
  await page.addInitScript(removeWebAuthn);

  await openSecurityListingUsedPasskey(page);

  expect(await registerButton(page).count()).toBe(0);
});

test("MFA が有効な user には、一覧は出るが、パスキーの行に登録の操作が出ない", async ({ page }) => {
  await routeEndpoint(page, "mfa.status", (route) =>
    route.fulfill({ json: { enabled: true, recovery_codes_remaining: 8 } }),
  );

  await openSecurityListingUsedPasskey(page);

  expect(await registerButton(page).count()).toBe(0);
});

test("パスキーが 0 本で登録できない時は、MFA の応答が一覧より後でも、セキュリティの画面の一覧が MFA の行だけになる", async ({
  page,
}) => {
  const passkeyListServed = Promise.withResolvers<void>();
  await routeEndpoint(page, "passkey.list", async (route) => {
    await route.fulfill({ json: { passkeys: [], can_register: false } });
    passkeyListServed.resolve();
  });
  await routeEndpoint(page, "mfa.status", async (route) => {
    await passkeyListServed.promise;
    await route.fallback();
  });
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(mfaRow(page)).toBeVisible();

  await expect(securityRows(page)).toHaveCount(1);
});
