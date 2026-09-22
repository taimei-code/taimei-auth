import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountAccountRoutes } from "../app";

// getSession は cookie が無ければ null (throw しても guard が fail-closed) なので、DB にも TTL store にも依存しない。
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
