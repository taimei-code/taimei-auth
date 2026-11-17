import { expect, test, type Page } from "@playwright/test";

type Api = { current: string; members: Record<string, string[]>; counts: Record<string, number> };

const mockApi = async (page: Page, options: { unauthorized?: boolean; delayMembersA?: number } = {}) => {
  const api: Api = {
    current: "A",
    members: { A: ["alice"], B: ["bob", "beth"] },
    counts: {},
  };
  const count = (key: string) => {
    api.counts[key] = (api.counts[key] ?? 0) + 1;
  };
  let delayedOnce = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    count(key);
    if (url.pathname === "/api/account/memberships") {
      if (options.unauthorized) return route.fulfill({ status: 401, body: "" });
      return route.fulfill({
        json: {
          current_company_id: api.current,
          memberships: [
            { company_id: "A", company_name: "A 社" },
            { company_id: "B", company_name: "B 社" },
          ],
        },
      });
    }
    if (url.pathname === "/api/account/current-company") {
      api.current = (request.postDataJSON() as { company_id: string }).company_id;
      return route.fulfill({ status: 200, body: "" });
    }
    const members = url.pathname.match(/^\/api\/companies\/(\w+)\/members$/);
    if (members) {
      const companyId = members[1]!;
      if (companyId === "A" && options.delayMembersA && !delayedOnce) {
        delayedOnce = true;
        await new Promise((resolve) => setTimeout(resolve, options.delayMembersA));
      }
      return route.fulfill({
        json: (api.members[companyId] ?? []).map((name) => ({ user_id: name, name })),
      });
    }
    const remove = url.pathname.match(/^\/api\/companies\/(\w+)\/members\/(\w+)$/);
    if (remove && request.method() === "DELETE") {
      api.members[remove[1]!] = api.members[remove[1]!]!.filter((name) => name !== remove[2]);
      return route.fulfill({ status: 200, body: "" });
    }
    if (/^\/api\/invitations\/\w+\/accept$/.test(url.pathname)) {
      return route.fulfill({ status: 200, body: "" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  return api;
};

test("M1: 事業所 A の遅い応答が B の画面に出ない", async ({ page }) => {
  await mockApi(page, { delayMembersA: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __staleA: number }).__staleA = 0;
    new MutationObserver(() => {
      const current = document.querySelector('[data-testid="current"]')?.textContent;
      if (current === "B" && document.querySelector('[data-company="A"]')) {
        (window as unknown as { __staleA: number }).__staleA += 1;
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto("/account/members");
  await expect(page.getByTestId("current")).toHaveText("A");
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "切替 B 社" }).click();
  await expect(page.getByTestId("current")).toHaveText("B");
  await expect(page.locator('[data-company="B"]')).toHaveCount(2);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { __staleA: number }).__staleA)).toBe(0);
  await expect(page.locator('[data-company="A"]')).toHaveCount(0);
});

test("M2: 削除の後にメンバー一覧と事業所状態の両方が再取得される", async ({ page }) => {
  const api = await mockApi(page);
  api.current = "B";
  await page.goto("/account/members");
  await expect(page.locator('[data-company="B"]')).toHaveCount(2);
  const before = { ...api.counts };
  await page.getByRole("button", { name: "削除 bob" }).click();
  await expect(page.locator('[data-company="B"]')).toHaveCount(1);
  await page.waitForTimeout(300);
  const delta = (key: string) => (api.counts[key] ?? 0) - (before[key] ?? 0);
  console.log("M2 delta", {
    members: delta("GET /api/companies/B/members"),
    companyState: delta("GET /api/account/memberships"),
  });
  expect(delta("GET /api/companies/B/members")).toBe(1);
  expect(delta("GET /api/account/memberships")).toBe(1);
});

test("M5a: 未認証なら子 route を描画せずに sign-in へ移る", async ({ page }) => {
  await mockApi(page, { unauthorized: true });
  await page.goto("/account/members");
  await expect(page.getByTestId("signin")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/auth");
  expect(await page.evaluate(() => window.__membersRenders ?? 0)).toBe(0);
});

test("M5b: 招待受諾の POST は StrictMode でも 1 回", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/auth/signup/accept-invitation?invitation_token=tok1");
  await expect(page).toHaveURL(/\/account\/members$/);
  await page.waitForTimeout(500);
  console.log("M5b posts", api.counts["POST /api/invitations/tok1/accept"]);
  expect(api.counts["POST /api/invitations/tok1/accept"]).toBe(1);
});

test("M6: /account/members と /auth/error が描画される", async ({ page }) => {
  await mockApi(page);
  await page.goto("/account/members");
  await expect(page.getByTestId("current")).toHaveText("A");
  await page.goto("/auth/error?reason=signin_failed");
  await expect(page.getByTestId("error-reason")).toHaveText("signin_failed");
  await page.goto("/auth/error?reason=bogus");
  await expect(page.getByTestId("error-reason")).toHaveText("default");
});
