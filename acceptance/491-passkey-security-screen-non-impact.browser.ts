// fallow-ignore-file unused-file
import { expect, test } from "@playwright/test";

import { mfaRow, openSecurityScreen } from "./harness/security-screen";

test("パスキーの一覧の取得が失敗しても、セキュリティの画面に MFA の行と「有効にする」が出る", async ({
  page,
}) => {
  await openSecurityScreen(page, { mfaEnabled: false, listFails: true });

  await expect(mfaRow(page)).toBeVisible();
  await expect(mfaRow(page).getByRole("button", { name: "有効にする" })).toBeVisible();
});
