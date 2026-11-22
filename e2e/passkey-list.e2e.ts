import { expect, type Page, test } from "@playwright/test";
import { routeEndpoint } from "./contract-mock";
import {
  type ListedPasskey,
  mfaRow,
  openSecurityListing,
  PASSKEY_EMAIL,
  passkeyItems,
  passkeyRow,
  signInWithMagicLink,
} from "./helpers";

const LIST_UNAVAILABLE = "パスキーの一覧を取得できませんでした。";

const listedPasskey: ListedPasskey = {
  id: "passkey-listed",
  created_at: "2026-03-04T03:00:00.000Z",
  last_used_at: null,
  provider_name: null,
};

test.use({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });

const openSecurityWithUnreadable = async (page: Page, passkeys: ReadonlyArray<unknown>) => {
  await routeEndpoint(page, "passkey.list", (route) =>
    route.fulfill({ json: { passkeys, can_register: true } }),
  );
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
};

test("一覧の応答が提供元の名前を持つパスキーは、その項目に提供元の名前が出る", async ({ page }) => {
  await openSecurityListing(page, [
    { ...listedPasskey, provider_name: "Google パスワードマネージャー" },
  ]);

  await expect(passkeyItems(page)).toContainText("Google パスワードマネージャー");
});

test("一覧の応答が提供元の名前を持たないパスキーは、その項目に「パスキー」と出て、画像を出さない", async ({
  page,
}) => {
  await openSecurityListing(page, [listedPasskey]);

  await expect(passkeyItems(page).getByText("パスキー", { exact: true })).toBeVisible();
  expect(await passkeyItems(page).locator("img, svg, picture").count()).toBe(0);
});

test("一覧の応答の登録日時が日時として読めない時、パスキーの行は一覧を取得できなかったと出し、MFA の行も描く", async ({
  page,
}) => {
  await openSecurityWithUnreadable(page, [{ ...listedPasskey, created_at: "not a date" }]);

  await expect(passkeyRow(page).getByText(LIST_UNAVAILABLE)).toBeVisible();
  await expect(mfaRow(page)).toBeVisible();
});

test("一覧の応答の最後に使った日時が日時として読めない時、パスキーの行は一覧を取得できなかったと出し、MFA の行も描く", async ({
  page,
}) => {
  await openSecurityWithUnreadable(page, [{ ...listedPasskey, last_used_at: "not a date" }]);

  await expect(passkeyRow(page).getByText(LIST_UNAVAILABLE)).toBeVisible();
  await expect(mfaRow(page)).toBeVisible();
});

test("日付の境を跨ぐ日時の応答では、browser の時間帯の日付で登録日と最後に使った日が出る", async ({
  page,
}) => {
  await openSecurityListing(page, [
    {
      ...listedPasskey,
      created_at: "2026-03-04T20:00:00.000Z",
      last_used_at: "2026-07-08T20:00:00.000Z",
    },
  ]);

  await expect(passkeyItems(page)).toContainText("登録日 2026/03/05");
  await expect(passkeyItems(page)).toContainText("最後に使った日 2026/07/09");
});
