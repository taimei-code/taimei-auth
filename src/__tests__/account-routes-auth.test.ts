import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Authenticated } from "../account/actor-contract";
import { JSON_HEADERS } from "../handlers/client-facing-error";
import { mountSpaApi, spaEndpoints } from "../handlers/spa-http-api";

// getSession は cookie が無ければ null (throw しても guard が fail-closed) なので、DB にも TTL store にも依存しない。
const app = new Hono();
mountSpaApi(app);

const routes = spaEndpoints().map(({ method, path, middleware }) => ({
  method,
  path: path.replace(/:(\w+)/g, "$1_x"),
  authenticated: [...middleware].some(({ key }) => key === Authenticated.key),
}));

const posts = routes.filter(({ method }) => method === "POST");
const authenticated = routes.filter((route) => route.authenticated);

describe("契約の POST の endpoint は、Content-Type の無い cross-site request を 403 にする (better-auth の origin 検査と同じ守り)", () => {
  test("POST の endpoint を契約から列挙できる", () => {
    expect(posts.length).toBeGreaterThanOrEqual(17);
  });

  for (const { path } of posts) {
    test(`POST ${path} → 403`, async () => {
      const res = await app.request(`http://localhost${path}`, {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(res.status).toBe(403);
    });
  }
});

describe("Authenticated を持つ endpoint は、cookie 無しの JSON request で 401", () => {
  test("Authenticated を持つ endpoint を契約から列挙できる", () => {
    expect(authenticated.length).toBeGreaterThanOrEqual(20);
  });

  for (const { method, path } of authenticated) {
    test(`${method} ${path} → 401 Unauthorized`, async () => {
      const res = await app.request(`http://localhost${path}`, { method, headers: JSON_HEADERS });
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(await res.json<unknown>()).toEqual({ _tag: "Unauthorized" });
    });
  }
});
