import { expect, test } from "@playwright/test";
import { reseedFixture, signInWithMagicLink, SWITCH_EMAIL } from "./helpers";
import { declaredFailure, routeEndpoint } from "./contract-mock";

test.beforeEach(() => reseedFixture("switch"));

test("役割変更と削除の後、一覧が取り直されて新しい状態を表示する", async ({ page }) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
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

test("招待を作ると招待中に出て、取り消すと消える", async ({ page }) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/members");
  const inviteeEmail = "e2e-switch-invitee@example.com";

  await page.getByLabel("メールアドレス").fill(inviteeEmail);
  await page.getByRole("button", { name: "招待する" }).click();
  await expect(page.getByText("招待を送信しました。")).toBeVisible();
  const pending = page.getByRole("region", { name: "招待中" });
  await expect(pending.getByText(inviteeEmail)).toBeVisible();

  await pending.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("招待を取り消しました。")).toBeVisible();
  await expect(pending.getByText(inviteeEmail)).toHaveCount(0);
});

test("招待の送信が試行枠の 429 (RateLimited) を受けると、回数の上限の文言を出す", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  await page.goto("/account/members");
  await routeEndpoint(page, "invitation.create", async (route) => {
    await route.fulfill(declaredFailure("invitation.create", "RateLimited"));
  });

  await page.getByLabel("メールアドレス").fill("e2e-switch-invitee@example.com");
  await page.getByRole("button", { name: "招待する" }).click();

  await expect(
    page.getByText("招待の送信回数が上限に達しました。時間をおいて再試行してください。"),
  ).toBeVisible();
  await expect(page.getByText("招待を送信しました。")).toHaveCount(0);
});

test("メンバー一覧と招待中の一覧の取得が失敗すると、見出しを残して取得できなかった旨を出す", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  let failedRequests = 0;
  for (const endpoint of ["membership.list", "invitation.pending"]) {
    await routeEndpoint(page, endpoint, async (route) => {
      failedRequests++;
      await route.fulfill({ status: 500, body: "" });
    });
  }

  await page.goto("/account/members");

  await expect(page.getByRole("heading", { name: "メンバー", exact: true })).toBeVisible();
  const list = page.getByRole("region", { name: "メンバー一覧" });
  await expect(list.getByRole("alert")).toHaveText("メンバーの一覧を取得できませんでした。");
  await expect(list.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText("招待中の一覧を取得できませんでした。")).toBeVisible();
  expect(failedRequests).toBeGreaterThanOrEqual(2);
});
