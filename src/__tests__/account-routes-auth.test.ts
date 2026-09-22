import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountAccountRoutes } from "../app";

// cookie の無い未認証リクエストで全 account route が 401 を返すことを確認し、guard の呼び忘れ (認可の
// 抜け) を検知する。getSession は cookie が無ければ null を返す (throw しても guard が fail-closed で
// null として扱う) ため、この smoke テストは DB にも TTL store にも依存しない。
// 登録は app.ts と同じ mountAccountRoutes を通すので、router への追加漏れ (guard を通らない route) も検知できる。
const buildApp = () => {
  const app = new Hono();
  mountAccountRoutes(app);
  return app;
};

const app = buildApp();

const routes: { method: "GET" | "POST"; path: string }[] = [
  { method: "POST", path: "/api/account/avatar/upload-token" },
  { method: "GET", path: "/api/account/memberships" },
  { method: "POST", path: "/api/account/companies" },
  { method: "POST", path: "/api/account/companies/add" },
  { method: "POST", path: "/api/account/companies/co_1" },
  { method: "POST", path: "/api/account/companies/co_1/delete" },
  { method: "GET", path: "/api/account/companies/co_1/members" },
  { method: "GET", path: "/api/account/companies/co_1/invitations" },
  { method: "POST", path: "/api/account/companies/co_1/invitations" },
  { method: "POST", path: "/api/account/companies/co_1/invitations/inv_1/revoke" },
  { method: "POST", path: "/api/account/accept-invitation" },
  { method: "POST", path: "/api/account/current-company" },
  { method: "POST", path: "/api/account/companies/co_1/members/u_1/role" },
  { method: "POST", path: "/api/account/companies/co_1/members/u_1/remove" },
  { method: "POST", path: "/api/account/companies/co_1/transfer-ownership" },
  { method: "GET", path: "/api/account/mfa" },
  { method: "POST", path: "/api/account/mfa/enroll" },
  { method: "POST", path: "/api/account/mfa/activate" },
  { method: "POST", path: "/api/account/mfa/disable" },
];

const MFA_ROUTE_PREFIX = "/api/account/mfa";

describe("account routes は cookie 無しで全て 401", () => {
  for (const { method, path } of routes) {
    test(`${method} ${path} → 401 unauthorized`, async () => {
      const res = await app.request(`http://localhost${path}`, { method });
      expect(res.status).toBe(401);
      expect(await res.json<unknown>()).toEqual({ error: "unauthorized" });
    });
  }
});

// MFA の 4 route は個別の app.route ではなく mountAccountRoutes に登録する。外れると 404 になって上の 401
// smoke テストの対象から外れ、guard を通らない route が気付かれないまま増える (認可の抜けを CI で検知できない)。
describe("QA-M-15 MFA route が mountAccountRoutes 経由で登録される", () => {
  test("4 route すべてが mountAccountRoutes だけのアプリで 401 に解決する", async () => {
    const mfaRoutes = routes.filter(({ path }) => path.startsWith(MFA_ROUTE_PREFIX));
    expect(mfaRoutes).toHaveLength(4);

    for (const { method, path } of mfaRoutes) {
      const res = await app.request(`http://localhost${path}`, { method });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });
});
