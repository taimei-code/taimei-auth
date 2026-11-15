import { expect, test } from "@playwright/test";
import { authEntryUrl } from "./helpers";

test("共通ログイン画面で空のまま送ると、メールアドレスの欄に focus が移って誤りを示し、入力すると誤りが消える", async ({
  page,
}) => {
  await page.goto(authEntryUrl());
  const email = page.getByLabel("メールアドレス");
  await expect(email).toHaveAttribute("aria-invalid", "false");

  await page.getByRole("button", { name: "Magic Link を送信" }).click();

  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAccessibleDescription("メールアドレスを入力してください。");

  await email.fill("user@example.com");

  await expect(email).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByText("メールアドレスを入力してください。")).toHaveCount(0);
});

test("共通サインアップ画面で空のまま送ると、最初の欄 (お名前) に focus が移る", async ({
  page,
}) => {
  await page.goto(authEntryUrl().replace("/auth/?", "/auth/signup?"));

  await page.getByRole("button", { name: "Magic Link で登録" }).click();

  await expect(page.getByLabel("お名前")).toBeFocused();
  await expect(page.getByText("お名前を入力してください。")).toBeVisible();
});
