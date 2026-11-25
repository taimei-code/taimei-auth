import { expect, type Page, test } from "@playwright/test";
import {
  addVirtualAuthenticator,
  agePastReauthenticationWindow,
  enableMfaViaApi,
  PASSKEY_EMAIL,
  passkeyItems,
  passkeyRow,
  passMfaChallenge,
  registerPasskeyButton,
  reseedFixture,
  signInAgainFromReauthentication,
  signInWithMagicLink,
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

const expectRegisteredByOneCreation = async (page: Page) => {
  await registerPasskeyButton(page).click();

  await expect(passkeyItems(page)).toHaveCount(1);
  expect(await creationCalls(page)).toBe(1);
};

test.describe.configure({ timeout: 90_000 });

test.beforeEach(() => reseedFixture("passkey"));

test("MFA が有効な user が「登録する」を押すと、確認コードの入力の dialog を出さずに browser のパスキーの作成へ進み、一覧に 1 行増える", async ({
  page,
}) => {
  await openSecurityWithMfa(page);

  await expectRegisteredByOneCreation(page);
});

test("MFA が有効な user は、古い session で「登録する」を押すとログインし直しへ送られ、Magic Link と MFA チャレンジを通った後は確認コード無しでパスキーを登録できる", async ({
  page,
}) => {
  const { secret } = await openSecurityWithMfa(page);
  await agePastReauthenticationWindow(page);

  await registerPasskeyButton(page).click();
  await signInAgainFromReauthentication(page, PASSKEY_EMAIL);
  await passMfaChallenge(page, secret);
  await expect(page).toHaveURL(/\/account\/security$/);

  await expectRegisteredByOneCreation(page);
});
