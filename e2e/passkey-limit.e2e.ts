import { expect, test } from "@playwright/test";
import { routeEndpoint } from "./contract-mock";
import {
  acceptPasskeyDeletions,
  confirmDeletionOf,
  type ListedPasskey,
  openSecurityListing,
  passkeyItems,
  passkeyRow,
  registerPasskeyButton,
} from "./helpers";

const DELETION_PROMPT = /削除(する|して)/;

const passkeys = (count: number): ReadonlyArray<ListedPasskey> =>
  Array.from({ length: count }, (_, index) => ({
    id: `passkey-${index + 1}`,
    created_at: "2026-03-04T03:00:00.000Z",
    last_used_at: null,
  }));

test("パスキーが 10 本ある時、「登録する」は押せず、不要なパスキーの削除を促す文言が出る", async ({
  page,
}) => {
  await openSecurityListing(page, passkeys(10));

  await expect(registerPasskeyButton(page)).toBeDisabled();
  await expect(passkeyRow(page).getByText(DELETION_PROMPT)).toBeVisible();
});

test("10 本あって「登録する」を押せない一覧から 1 本を削除すると、「登録する」を押せるようになる", async ({
  page,
}) => {
  const listed = await openSecurityListing(page, passkeys(10));
  await acceptPasskeyDeletions(page, listed);
  await expect(registerPasskeyButton(page)).toBeDisabled();

  await confirmDeletionOf(page, passkeyItems(page).first());

  await expect(passkeyItems(page)).toHaveCount(9);
  await expect(registerPasskeyButton(page)).toBeEnabled();
});

test("パスキーが 9 本ある時は、「登録する」を押せる", async ({ page }) => {
  await openSecurityListing(page, passkeys(9));

  await expect(registerPasskeyButton(page)).toBeEnabled();
});

test("登録が止まっている時は、パスキーが 10 本あっても「登録する」が出ない", async ({ page }) => {
  await openSecurityListing(page, passkeys(10), { canRegister: false });

  expect(await registerPasskeyButton(page).count()).toBe(0);
});

test("MFA が有効な user には、パスキーが 10 本あっても「登録する」が出ない", async ({ page }) => {
  await routeEndpoint(page, "mfa.status", (route) =>
    route.fulfill({ json: { enabled: true, recovery_codes_remaining: 8 } }),
  );

  await openSecurityListing(page, passkeys(10));

  expect(await registerPasskeyButton(page).count()).toBe(0);
});
