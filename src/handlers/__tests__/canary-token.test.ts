import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimitMiddleware } from "../../rate-limit";
import { setSentryBackend, type CaptureContext } from "../../sentry";
import { canaryToken } from "../canary-token";

// Sentry backend は module-global のため、spy 注入後は console fallback 相当へ戻して
// 同一プロセスで走る後続 test file に spy を漏らさない。

type Captured = { message: string; context?: CaptureContext };

let captured: Captured[] = [];

const spyBackend = {
  captureException: () => {},
  captureMessage: (message: string, context?: CaptureContext) => {
    captured.push({ message, context });
  },
};

const consoleFallback = {
  captureException: (error: unknown) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message: string, context?: CaptureContext) =>
    console.warn("[sentry:noop] captureMessage", message, context?.tags),
};

const buildApp = () => {
  const app = new Hono();
  app.route("/", canaryToken);
  return app;
};

describe("canary token endpoint", () => {
  beforeEach(() => {
    captured = [];
    setSentryBackend(spyBackend);
  });

  afterAll(() => {
    setSentryBackend(consoleFallback);
  });

  test("GET /auth/canary-token/abc123 は 204 + token_id/embed_type を Sentry に送る", async () => {
    const res = await buildApp().request("/auth/canary-token/abc123", {
      headers: { "user-agent": "test-agent", referer: "https://example.com/phish" },
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("Canary token triggered");
    expect(captured[0]?.context?.level).toBe("warning");
    expect(captured[0]?.context?.tags).toEqual({
      token_id: "abc123",
      embed_type: "link-or-form",
    });
    expect(captured[0]?.context?.extra).toMatchObject({
      userAgent: "test-agent",
      referer: "https://example.com/phish",
    });
  });

  test("`.ico` suffix は embed_type=favicon になり token_id から strip される", async () => {
    const res = await buildApp().request("/auth/canary-token/abc.ico");

    expect(res.status).toBe(204);
    expect(captured[0]?.context?.tags).toEqual({
      token_id: "abc",
      embed_type: "favicon",
    });
  });

  test("user-agent / referer 不在時は unknown で送る (500 に落ちない)", async () => {
    const res = await buildApp().request("/auth/canary-token/xyz");

    expect(res.status).toBe(204);
    expect(captured[0]?.context?.extra).toMatchObject({
      userAgent: "unknown",
      referer: "unknown",
    });
  });
});

describe("canary token の rate limit 合成 (app.ts と同構成)", () => {
  beforeEach(() => {
    captured = [];
    setSentryBackend(spyBackend);
  });

  afterAll(() => {
    setSentryBackend(consoleFallback);
  });

  test("上限超過は 429 になり Sentry 送信自体が止まる (quota 保護)", async () => {
    const app = new Hono();
    // 実行ごとに固有キーで実 Redis の窓を汚さない (windowSec 内の再実行でも衝突しない)
    const key = `rate-limit:canary-test:${crypto.randomUUID()}`;
    app.use(
      "/auth/canary-token/*",
      createRateLimitMiddleware({ keyFn: () => key, limit: 2, windowSec: 60 }),
    );
    app.route("/", canaryToken);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/auth/canary-token/burst");
      statuses.push(res.status);
    }

    expect(statuses).toEqual([204, 204, 429, 429]);
    expect(captured).toHaveLength(2);
  });
});
