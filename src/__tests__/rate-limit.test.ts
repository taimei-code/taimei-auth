import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimitMiddleware } from "../rate-limit";
import { connectRedis, redis } from "../redis";

beforeAll(async () => {
  await connectRedis();
});

const buildApp = (key: string, limit: number, windowSec = 60) => {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware({ keyFn: () => key, limit, windowSec }));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
};

describe("rate-limit middleware", () => {
  beforeEach(async () => {
    const keys = await redis.keys("rate-limit:test:*");
    if (keys.length > 0) await redis.del(keys);
  });

  test("limit 5 で 6 req 目に 429 + Retry-After", async () => {
    const app = buildApp("rate-limit:test:fixed-key", 5);
    for (let i = 0; i < 5; i++) {
      const res = await app.request("http://localhost/");
      expect(res.status).toBe(200);
    }
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test("limit 1 で 2 req 目に 429", async () => {
    const app = buildApp("rate-limit:test:small-limit", 1);
    const withinLimit = await app.request("http://localhost/");
    expect(withinLimit.status).toBe(200);
    const overLimit = await app.request("http://localhost/");
    expect(overLimit.status).toBe(429);
  });

  test("異なる key は独立 (rate-limit:test:A は B の counter に影響しない)", async () => {
    const appA = buildApp("rate-limit:test:keyA", 1);
    const appB = buildApp("rate-limit:test:keyB", 1);
    expect((await appA.request("http://localhost/")).status).toBe(200);
    expect((await appA.request("http://localhost/")).status).toBe(429);
    expect((await appB.request("http://localhost/")).status).toBe(200);
  });
});
