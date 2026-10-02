import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountAccountRoutes } from "../app";
import { JSON_HEADERS } from "../handlers/client-facing-error";

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
  { method: "POST", path: "/api/account/delete" },
  { method: "POST", path: "/api/account/companies/co_1/members/u_1/role" },
  { method: "POST", path: "/api/account/companies/co_1/members/u_1/remove" },
  { method: "POST", path: "/api/account/companies/co_1/transfer-ownership" },
  { method: "GET", path: "/api/account/mfa" },
  { method: "POST", path: "/api/account/mfa/enroll" },
  { method: "POST", path: "/api/account/mfa/activate" },
  { method: "POST", path: "/api/account/mfa/disable" },
];

describe("account の POST route は Content-Type の無い cross-site request を 403 にする (better-auth の origin 検査と同じ守り)", () => {
  for (const { path } of routes.filter(({ method }) => method === "POST")) {
    test(`POST ${path} → 403`, async () => {
      const res = await app.request(`http://localhost${path}`, {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(res.status).toBe(403);
    });
  }
});

const MFA_ROUTE_PREFIX = "/api/account/mfa";

describe("account routes は cookie 無しの JSON request で全て 401 (Content-Type の無い POST は csrf() が先に 403 にする)", () => {
  for (const { method, path } of routes) {
    test(`${method} ${path} → 401 unauthorized`, async () => {
      const res = await app.request(`http://localhost${path}`, { method, headers: JSON_HEADERS });
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
      const res = await app.request(`http://localhost${path}`, { method, headers: JSON_HEADERS });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });
});
