import { expect, type Page, test } from "@playwright/test";
import {
  addVirtualAuthenticator,
  enableMfaViaApi,
  PASSKEY_EMAIL,
  passkeyItems,
  passkeyRow,
  registerPasskeyButton,
  reseedFixture,
  signInWithMagicLink,
  totpCode,
  wrongTotpCode,
} from "./helpers";

const countCreationCalls = () => {
  const credentials = navigator.credentials;
  const create = credentials.create.bind(credentials);
  const state = { calls: 0 };
  Object.assign(window, { __creationCalls: state });
  credentials.create = (options) => {
    state.calls += 1;
    return create(options);
  };
};

const creationCalls = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __creationCalls: { calls: number } }).__creationCalls.calls,
  );

const openSecurityWithMfa = async (page: Page) => {
  await page.addInitScript(countCreationCalls);
  await addVirtualAuthenticator(page);
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  const enabled = await enableMfaViaApi(page);
  await page.goto("/account/security");
  await expect(passkeyRow(page)).toBeVisible();
  return enabled;
};

const sendCode = async (page: Page, code: string) => {
  await registerPasskeyButton(page).click();
  const codeInput = page.getByRole("dialog").getByRole("textbox");
  await codeInput.fill(code);
  await codeInput.press("Enter");
  return codeInput;
};

test.beforeEach(() => reseedFixture("passkey"));

test("MFA が有効な user が誤った確認コードを送ると、入力欄に誤りが示され、browser のパスキーの作成は呼ばれない", async ({
  page,
}) => {
  const { secret } = await openSecurityWithMfa(page);

  const codeInput = await sendCode(page, await wrongTotpCode(secret));

  await expect(codeInput).toHaveAccessibleDescription(/正しくありません/);
  expect(await creationCalls(page)).toBe(0);
  expect(await passkeyItems(page).count()).toBe(0);
});

test("MFA が有効な user が正しい確認コードを送ると、browser のパスキーの作成を経て、一覧に未使用のパスキーが 1 行増える", async ({
  page,
}) => {
  const { secret } = await openSecurityWithMfa(page);

  await sendCode(page, await totpCode(secret));

  await expect(passkeyItems(page)).toHaveCount(1);
  await expect(passkeyRow(page)).toContainText("未使用");
  expect(await creationCalls(page)).toBe(1);
});
