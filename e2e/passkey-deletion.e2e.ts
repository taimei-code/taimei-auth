import { expect, type Locator, type Page, test } from "@playwright/test";
import { declaredFailure, endpointPattern, routeEndpoint } from "./contract-mock";
import {
  addVirtualAuthenticator,
  featureFlags,
  mfaRow,
  PASSKEY_EMAIL,
  passkeyItems,
  passkeyRow,
  registerPasskeyButton,
  reseedFixture,
  securityRows,
  signInWithMagicLink,
} from "./helpers";

const PASSKEY = "passkey";
const FAILURE_NOTICE = /失敗|できません|見つかりません|上限/;
const DELETION_URL = endpointPattern("passkey.delete");

type ListedPasskey = { id: string; created_at: string; last_used_at: string | null };

const OLDER: ListedPasskey = {
  id: "passkey-older",
  created_at: "2026-03-04T03:00:00.000Z",
  last_used_at: null,
};

const NEWER: ListedPasskey = {
  id: "passkey-newer",
  created_at: "2026-07-08T03:00:00.000Z",
  last_used_at: null,
};

const OLDER_ITEM_TEXT = "登録日 2026/03/04";
const NEWER_ITEM_TEXT = "登録日 2026/07/08";

test.use({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });

test.afterEach(({ request }) => featureFlags(request).on(PASSKEY));

const sentDeletionPaths = (page: Page): string[] => {
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && DELETION_URL.test(request.url())) {
      paths.push(new URL(request.url()).pathname);
    }
  });
  return paths;
};

const confirmationDialog = (page: Page) => page.getByRole("dialog");

const confirmDeletionButton = (page: Page) =>
  confirmationDialog(page).getByRole("button", { name: /削除/ });

const openConfirmationOf = async (page: Page, item: Locator) => {
  const deleteButton = item.getByRole("button", { name: /削除/ });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await expect(confirmationDialog(page)).toBeVisible();
};

const confirmDeletionOf = async (page: Page, item: Locator) => {
  await openConfirmationOf(page, item);
  await confirmDeletionButton(page).click();
};

const openSecurityWithRegisteredPasskey = async (page: Page) => {
  reseedFixture("passkey");
  await addVirtualAuthenticator(page);
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await registerPasskeyButton(page).click();
  await expect(passkeyItems(page)).toHaveCount(1);
};

const openSecurityListing = async (page: Page, passkeys: ReadonlyArray<ListedPasskey>) => {
  const listed = { passkeys };
  await routeEndpoint(page, "passkey.list", (route) =>
    route.fulfill({ json: { passkeys: listed.passkeys, can_register: true } }),
  );
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(passkeyItems(page)).toHaveCount(passkeys.length);
  return listed;
};

const acceptDeletions = (page: Page, listed: { passkeys: ReadonlyArray<ListedPasskey> }) =>
  routeEndpoint(page, "passkey.delete", async (route) => {
    const deletedId = new URL(route.request().url()).pathname.split("/").at(-2);
    listed.passkeys = listed.passkeys.filter((passkey) => passkey.id !== deletedId);
    await route.fulfill({ json: { ok: true } });
  });

test("登録したパスキーの「削除」から確認の dialog で削除を選ぶと、その行が一覧から消える", async ({
  page,
}) => {
  await openSecurityWithRegisteredPasskey(page);

  await confirmDeletionOf(page, passkeyItems(page));

  await expect(passkeyItems(page)).toHaveCount(0);
  await expect(page.getByText("パスキーを削除しました。")).toBeVisible();
});

test("2 本のうち 1 本の削除を確定すると、削除の API にそのパスキーの id が 1 回だけ送られ、その行だけが消える", async ({
  page,
}) => {
  const deletions = sentDeletionPaths(page);
  const listed = await openSecurityListing(page, [OLDER, NEWER]);
  await acceptDeletions(page, listed);

  await confirmDeletionOf(page, passkeyItems(page).filter({ hasText: OLDER_ITEM_TEXT }));

  await expect(passkeyItems(page)).toHaveCount(1);
  await expect(passkeyItems(page)).toContainText(NEWER_ITEM_TEXT);
  expect(deletions).toEqual([`/api/account/passkeys/${OLDER.id}/delete`]);
});

test("MFA が有効な user も、一覧の「削除」からパスキーを削除できる", async ({ page }) => {
  await routeEndpoint(page, "mfa.status", (route) =>
    route.fulfill({ json: { enabled: true, recovery_codes_remaining: 8 } }),
  );
  const deletions = sentDeletionPaths(page);
  const listed = await openSecurityListing(page, [OLDER]);
  await acceptDeletions(page, listed);

  await confirmDeletionOf(page, passkeyItems(page));

  await expect(passkeyItems(page)).toHaveCount(0);
  expect(deletions).toEqual([`/api/account/passkeys/${OLDER.id}/delete`]);
});

test("「削除」を押すと「キャンセル」と削除の確定を持つ確認の dialog が出て、選ぶまで削除の API に何も送られない", async ({
  page,
}) => {
  const deletions = sentDeletionPaths(page);
  await openSecurityListing(page, [OLDER]);

  await openConfirmationOf(page, passkeyItems(page));

  await expect(confirmationDialog(page).getByRole("button", { name: "キャンセル" })).toBeVisible();
  await expect(confirmDeletionButton(page)).toBeVisible();
  expect(deletions).toEqual([]);
});

const WAYS_TO_CLOSE: ReadonlyArray<{ way: string; close: (page: Page) => Promise<void> }> = [
  {
    way: "「キャンセル」",
    close: (page) => confirmationDialog(page).getByRole("button", { name: "キャンセル" }).click(),
  },
  {
    way: "「閉じる」",
    close: (page) => confirmationDialog(page).getByRole("button", { name: "閉じる" }).click(),
  },
  { way: "Escape", close: (page) => page.keyboard.press("Escape") },
];

for (const { way, close } of WAYS_TO_CLOSE) {
  test(`確認の dialog を${way}で閉じると、行は残り、削除の API に何も送られない`, async ({
    page,
  }) => {
    const deletions = sentDeletionPaths(page);
    await openSecurityListing(page, [OLDER]);
    await openConfirmationOf(page, passkeyItems(page));

    await close(page);

    await expect(confirmationDialog(page)).toBeHidden();
    expect(await passkeyItems(page).count()).toBe(1);
    expect(deletions).toEqual([]);
  });
}

const FAILED_DELETIONS = [
  { cause: "見つからない", response: declaredFailure("passkey.delete", "NotFound") },
  { cause: "試行枠を超えた", response: declaredFailure("passkey.delete", "RateLimited") },
  { cause: "server の誤り", response: { status: 500, json: {} } },
];

for (const { cause, response } of FAILED_DELETIONS) {
  test(`削除が${cause}で失敗すると、失敗を述べる文言が出て、行は残る`, async ({ page }) => {
    await openSecurityListing(page, [OLDER]);
    await routeEndpoint(page, "passkey.delete", (route) => route.fulfill(response));

    await confirmDeletionOf(page, passkeyItems(page));

    await expect(page.getByText(FAILURE_NOTICE).first()).toBeVisible();
    expect(await passkeyItems(page).count()).toBe(1);
  });
}

test("最後の 1 本を削除すると、パスキーが無いことを述べる表示になる", async ({ page }) => {
  const listed = await openSecurityListing(page, [OLDER]);
  await acceptDeletions(page, listed);

  await confirmDeletionOf(page, passkeyItems(page));

  await expect(passkeyRow(page)).toContainText("登録したパスキーはありません");
});

test("パスキーの登録が止まっている時に最後の 1 本を削除すると、セキュリティの画面の一覧は MFA の行だけになる", async ({
  page,
}) => {
  await openSecurityWithRegisteredPasskey(page);
  await featureFlags(page.request).off(PASSKEY);
  await page.reload();
  await expect(passkeyItems(page)).toHaveCount(1);

  await confirmDeletionOf(page, passkeyItems(page));

  await expect(securityRows(page)).toHaveCount(1);
  await expect(mfaRow(page)).toBeVisible();
});
