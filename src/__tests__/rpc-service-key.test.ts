import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../app";
import { recordSentry } from "./sentry-recorder";

const originalEnv = { ...process.env };
const app = buildApp({ mountStatic: () => {} });
const { exceptions: captured } = recordSentry();
const UNKNOWN_RPC = "http://localhost/rpc/auth.v1.AuthService/Nope";

const request = (headers: Record<string, string> = {}) => app.request(UNKNOWN_RPC, { headers });

beforeEach(() => {
  delete process.env.AUTH_SERVICE_KEY;
  delete process.env.AUTH_SERVICE_KEY_PREVIOUS;
  delete process.env.APP_ENV;
});

afterEach(() => {
  process.env = { ...originalEnv };
  expect(captured).toHaveLength(0);
});

describe("/rpc/* の service key middleware (応答 byte 不変、Sentry 0 件)", () => {
  test.each([
    ["不一致", { "X-Service-Key": "wrong" }],
    ["未提示", {}],
  ])("不一致 / 未提示 (%s) → 401 JSON", async (_, headers) => {
    process.env.AUTH_SERVICE_KEY = "k";
    const res = await request(headers);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"_tag":"ServiceKeyRejected"}');
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test.each([
    "production",
    "development",
  ])("未設定なら APP_ENV=%s でも 503 JSON", async (appEnv) => {
    process.env.APP_ENV = appEnv;
    const res = await request({ "X-Service-Key": "any" });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"_tag":"ServiceKeyMisconfigured"}');
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("一致 → next() が呼ばれ rpc router の 404", async () => {
    process.env.AUTH_SERVICE_KEY = "k";
    const res = await request({ "X-Service-Key": "k" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"_tag":"NotFound"}');
  });
});
