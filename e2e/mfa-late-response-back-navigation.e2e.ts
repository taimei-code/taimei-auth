import { expect, type Page, test } from "@playwright/test";
import { endpointPattern, routeEndpoint } from "./contract-mock";
import { BASE_URL, MFA_EMAIL, mfaRow, reseedFixture, signInWithMagicLink } from "./helpers";

const SECURITY_URL = `${BASE_URL}/account/security`;
const ENROLL = "mfa.enroll";
const QR_STEP_TEXT = "認証アプリで QR コードを読み取ってください";

const holdEveryEnrollResponse = async (page: Page) => {
  const releases: (() => void)[] = [];
  await routeEndpoint(page, ENROLL, async (route) => {
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    await route.continue();
  });
  const release = async (index: number) => {
    const answered = page.waitForResponse(endpointPattern(ENROLL));
    releases[index]?.();
    await (await answered).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  };
  return { heldCount: () => releases.length, release };
};

test("有効化の応答を待つ間に「戻る」「進む」でセキュリティへ戻り、新しい page で有効化を始めると、前の page の応答では QR コードの段に進まず、新しい page の応答で進む", async ({
  page,
}) => {
  reseedFixture("mfa");
  await signInWithMagicLink(page, MFA_EMAIL);
  await expect(page).toHaveURL(`${BASE_URL}/account`);
  await page.getByRole("link", { name: "セキュリティ" }).click();
  await expect(page).toHaveURL(SECURITY_URL);
  const held = await holdEveryEnrollResponse(page);

  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  await expect.poll(held.heldCount).toBe(1);
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL(SECURITY_URL);
  await mfaRow(page).getByRole("button", { name: "有効にする" }).click();
  await expect.poll(held.heldCount).toBe(2);

  await held.release(0);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(QR_STEP_TEXT)).toHaveCount(0);

  await held.release(1);
  await expect(dialog.getByText(QR_STEP_TEXT)).toBeVisible();
});
