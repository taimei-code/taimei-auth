import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";

import { buildApp } from "../app";
import { clearSiteDataOnSignOut } from "../security-headers";
import { dbTest } from "./live-runner";
import { createSessionFor } from "./session-helpers";
import { TestDb } from "./test-db";

const signOutReturning = (status: 200 | 401) => {
  const app = new Hono();
  app.use("/api/auth/sign-out", clearSiteDataOnSignOut);
  app.post("/api/auth/sign-out", (c) => c.json({}, status));
  return app.request("http://localhost/api/auth/sign-out", { method: "POST" });
};

const clearedOnSuccessfulSignOut = async () =>
  ((await signOutReturning(200)).headers.get("Clear-Site-Data") ?? "")
    .split(",")
    .map((directive) => directive.trim());

describe("sign-out の Clear-Site-Data", () => {
  test("成功した sign-out は storage だけを消し、cache を消さない。cache を足すと browser が HTTP cache 全体を消し終えるまで応答を page に渡さず、ログアウトの後に画面が十数秒移らない", async () => {
    expect(await clearedOnSuccessfulSignOut()).toEqual(['"storage"']);
  });

  test("成功した sign-out は cookies を消さない。cookies か * を足すと consumer の subdomain の cookie まで消える", async () => {
    const cleared = await clearedOnSuccessfulSignOut();
    expect(cleared).not.toContain('"cookies"');
    expect(cleared).not.toContain('"*"');
  });

  test("失敗した sign-out は何も消さない。session が残ったまま画面の状態だけが消える", async () => {
    expect((await signOutReturning(401)).headers.get("Clear-Site-Data")).toBeNull();
  });
});

const ORIGIN = "http://localhost";
const SPA_DOCUMENT = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';

const app = () => buildApp({ mountStatic: (spa) => spa.get("*", (c) => c.html(SPA_DOCUMENT)) });

const documentResponse = () => app().request(`${ORIGIN}/account`);
const apiResponse = () => app().request(`${ORIGIN}/api/auth/ok`);

const directivesOf = (policy: string | null) =>
  (policy ?? "")
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "");

describe("SPA の document と API の応答の security の header", () => {
  test("SPA の document の応答は、CSP の frame-ancestors 'none' と X-Frame-Options: DENY を持つ", async () => {
    const response = await documentResponse();
    expect(directivesOf(response.headers.get("Content-Security-Policy"))).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test.each([
    ["SPA の document", documentResponse],
    ["API", apiResponse],
  ] as const)("%s の応答は X-Content-Type-Options: nosniff と Referrer-Policy: strict-origin-when-cross-origin を持つ", async (_name, respond) => {
    const response = await respond();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  test("SPA の document の応答は、強制の CSP で script-src 'self'・object-src 'none'・base-uri 'none' を持つ", async () => {
    const directives = directivesOf(
      (await documentResponse()).headers.get("Content-Security-Policy"),
    );
    expect(directives).toEqual(
      expect.arrayContaining(["script-src 'self'", "object-src 'none'", "base-uri 'none'"]),
    );
  });

  test("app に組んだ sign-out の応答は Clear-Site-Data を持つ", async () => {
    const response = await app().request(`${ORIGIN}/api/auth/sign-out`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: "{}",
    });
    expect(response.headers.get("Clear-Site-Data")).not.toBeNull();
  });
});

const { run, cleanup } = dbTest("cache-control-test-");

const signedInGet = (path: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const user = yield* db.seedUser("u1");
    const { headers } = yield* createSessionFor(user.id);
    return yield* Effect.promise(async () => app().request(`${ORIGIN}${path}`, { headers }));
  });

const appServingAt = (path: string, cacheControl: string | undefined) =>
  buildApp({
    mountStatic: (spa) =>
      spa.get(path, (c) => {
        if (cacheControl !== undefined) c.header("Cache-Control", cacheControl);
        return c.body("export {};", 200, { "content-type": "text/javascript" });
      }),
  });

describe("sign-out が HTTP cache を消さないので、session を読む API の私的な応答を browser に cache させない", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test.each([
    "/api/account/memberships",
    "/api/auth/list-sessions",
  ])("ログインした利用者への %s の応答は Cache-Control: no-store を持つ", (path) =>
    run(
      Effect.gen(function* () {
        const response = yield* signedInGet(path);
        expect([response.status, response.headers.get("Cache-Control")]).toEqual([200, "no-store"]);
      }),
    ));

  test("session の無い要求への /api/account/memberships の 401 の応答も Cache-Control: no-store を持つ", async () => {
    const response = await app().request(`${ORIGIN}/api/account/memberships`);
    expect([response.status, response.headers.get("Cache-Control")]).toEqual([401, "no-store"]);
  });
});

describe("配信元が付けた Cache-Control は変えず、/api の外の応答には no-store を付けない", () => {
  test("API の handler が自分で付けた Cache-Control は、そのまま利用者に届く", async () => {
    const response = await appServingAt("/api/handler-owned", "private, max-age=60").request(
      `${ORIGIN}/api/handler-owned`,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  test("静的な file の応答は、配信元が付けた Cache-Control のまま", async () => {
    const response = await appServingAt(
      "/auth/assets/*",
      "public, max-age=31536000, immutable",
    ).request(`${ORIGIN}/auth/assets/index-abc123.js`);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  test("配信元が Cache-Control を付けない静的な file の応答は、Cache-Control を持たないまま", async () => {
    const response = await appServingAt("/auth/assets/*", undefined).request(
      `${ORIGIN}/auth/assets/index-abc123.js`,
    );
    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});
