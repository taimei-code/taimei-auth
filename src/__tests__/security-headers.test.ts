import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

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
