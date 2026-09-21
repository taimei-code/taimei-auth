import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { buildApp } from "../app";
import { recordSentryExceptions } from "./sentry-recorder";

const originalEnv = { ...process.env };
const app = buildApp({ mountStatic: () => {} });
const captured = recordSentryExceptions();
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
    ["AC-012", { "X-Service-Key": "wrong" }],
    ["AC-013", {}],
  ])("%s: 不一致 / 未提示 → 401 JSON", async (_, headers) => {
    process.env.AUTH_SERVICE_KEY = "k";
    const res = await request(headers);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":"Unauthorized: invalid service key"}');
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("AC-014: 未設定 + production → 503 JSON", async () => {
    process.env.APP_ENV = "production";
    const res = await request({ "X-Service-Key": "any" });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":"Service Key not configured (production)"}');
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("AC-015: 一致 → next() が呼ばれ rpc router の 404", async () => {
    process.env.AUTH_SERVICE_KEY = "k";
    const res = await request({ "X-Service-Key": "k" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":"Not Found"}');
  });

  test("AC-016: 未設定 + development → 未提示でも 404 (通す)", async () => {
    process.env.APP_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await request();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"Not Found"}');
    } finally {
      warn.mockRestore();
    }
  });
});
