import { afterEach, describe, expect, test } from "bun:test";
import { buildApp } from "../app";

// deploy.yml の smoke テストが、version override header の反映を /health の version で照合する。
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
