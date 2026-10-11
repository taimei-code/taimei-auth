import { expect, test } from "@playwright/test";
import { reseedFixture, signInWithMagicLink } from "./helpers";

test.beforeEach(() => reseedFixture("switch"));

test("役割変更と削除の後、一覧が取り直されて新しい状態を表示する", async ({ page }) => {
  await signInWithMagicLink(page, "e2e-switch@example.com");
  await page.goto("/account/members");
  const list = page.getByRole("region", { name: "メンバー一覧" });
  const mateRole = list.getByRole("combobox", { name: "e2e-switch-a-mate@example.com の役割" });
  await expect(mateRole).toHaveValue("MEMBER");

  const listRequests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && /\/api\/account\/companies\/[^/]+\/members$/.test(r.url())) {
      listRequests.push(r.url());
    }
  });
  await mateRole.selectOption("ADMIN");
  await expect(page.getByText("E2E SwitchAMate の役割を管理者に変更しました。")).toBeVisible();
  await expect(mateRole).toHaveValue("ADMIN");
  expect(listRequests.length).toBeGreaterThanOrEqual(1);

  await list.getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByText(/メンバーを削除しました/)).toBeVisible();
  await expect(list.getByText("E2E SwitchAMate")).toHaveCount(0);
});
