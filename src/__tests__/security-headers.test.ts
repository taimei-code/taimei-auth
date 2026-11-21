import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { buildApp } from "../app";
import { clearSiteDataOnSignOut } from "../security-headers";

const signOutReturning = (status: 200 | 401) => {
  const app = new Hono();
  app.use("/api/auth/sign-out", clearSiteDataOnSignOut);
  app.post("/api/auth/sign-out", (c) => c.json({}, status));
  return app.request("http://localhost/api/auth/sign-out", { method: "POST" });
};

describe("sign-out の Clear-Site-Data", () => {
  test("成功した sign-out は cache と storage だけを消す。cookies を足すと consumer の subdomain の cookie まで消える", async () => {
    expect((await signOutReturning(200)).headers.get("Clear-Site-Data")).toBe('"cache", "storage"');
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
