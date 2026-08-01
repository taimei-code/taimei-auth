import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { buildSpaFallbackHandler } from "../spa-fallback";

// CI には web/dist が存在しない (build:web は deploy 時のみ) ため、実 dist に依存せず
// 一時ファイル fixture を handler に注入する。status だけの assert は index.html 不在でも
// 200 が返り false-green になるため、body 内容まで必ず読み切って検証する。

const FIXTURE_HTML = "<!DOCTYPE html><html><body>spa-fixture</body></html>";

const buildApp = () => {
  const dir = mkdtempSync(join(tmpdir(), "spa-fallback-test-"));
  const indexPath = join(dir, "index.html");
  writeFileSync(indexPath, FIXTURE_HTML);
  const app = new Hono();
  app.get("/auth/*", buildSpaFallbackHandler(indexPath));
  app.get("/account/*", buildSpaFallbackHandler(indexPath));
  return app;
};

describe("spa-fallback", () => {
  test("拡張子なし path は index.html の内容を text/html で返す", async () => {
    const res = await buildApp().request("/account/members");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    expect(await res.text()).toBe(FIXTURE_HTML);
  });

  test("拡張子あり path (/auth/app.js) は 404 (存在しない asset を HTML で埋めない)", async () => {
    const res = await buildApp().request("/auth/app.js");
    expect(res.status).toBe(404);
  });

  test.each([
    ["dot を含む画面 path の亜種 (末尾が拡張子に見える)", "/account/v1.2"],
    ["相対 traversal", "/account/../secret.txt"],
    [
      "encoded traversal (pathname は encoded のまま末尾 .txt 扱い)",
      "/account/%2e%2e%2fsecret.txt",
    ],
  ])("%s は 404 (handler は固定 index.html 以外を配信しない)", async (_name, path) => {
    const res = await buildApp().request(path);
    expect(res.status).toBe(404);
  });
});
