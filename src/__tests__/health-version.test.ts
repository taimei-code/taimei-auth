import { afterEach, describe, expect, test } from "bun:test";
import { buildApp } from "../app";

// deploy.yml の smoke テストは version override header で配分 0% の version にリクエストするため、応答がどの version から
// 来たかを /health の version で照合する (override が反映されないと、旧 version の 200 で中身のないまま通ってしまう)。
describe("/health の version", () => {
  const original = process.env.CF_VERSION_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.CF_VERSION_ID;
    else process.env.CF_VERSION_ID = original;
  });

  test("CF_VERSION_ID 未設定 (Bun) は null", async () => {
    delete process.env.CF_VERSION_ID;
    const res = await buildApp({ mountStatic: () => {} }).request("http://localhost/health");
    expect((await res.json<{ version: unknown }>()).version).toBeNull();
  });

  test("CF_VERSION_ID があればその値", async () => {
    process.env.CF_VERSION_ID = "11111111-2222-3333-4444-555555555555";
    const res = await buildApp({ mountStatic: () => {} }).request("http://localhost/health");
    expect((await res.json<{ version: unknown }>()).version).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
});
