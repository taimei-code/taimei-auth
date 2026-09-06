import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { createRateLimitMiddleware, rateLimitProgram } from "../rate-limit";
import { getRedis } from "../redis";
import type { Redis } from "../redis-service";
import { type SentryService, SentryLive } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";
import { failingRedisLayer, redisReturning } from "./test-layers";

// AC-043: E channel は never のまま (kernel が RedisError を畳む)、Hono 非依存。
rateLimitProgram satisfies (input: {
  key: string;
  limit: number;
  windowSec: number;
}) => Effect.Effect<Response | undefined, never, Redis | SentryService>;

describe("rateLimitProgram (Redis 無し)", () => {
  const captured = recordSentryExceptions();
  const check = (redis: Layer.Layer<Redis>) =>
    Effect.runPromise(
      Effect.provide(
        rateLimitProgram({ key: "rate-limit:test:stub", limit: 5, windowSec: 60 }),
        Layer.mergeAll(redis, SentryLive),
      ),
    );

  test("計数不能 (RedisError) は fail-open で通し、Sentry に rate-limit / warning を 1 回記録する", async () => {
    const before = captured.length;
    expect(await check(failingRedisLayer)).toBeUndefined();
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("rate-limit");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("上限 + 1 は 429 で Retry-After は windowSec (ttl ではない)", async () => {
    const res = await check(redisReturning({ count: 6, ttl: 7 }));
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("60");
    expect(res?.headers.get("content-type")).toBe("application/json");
    expect(await res?.json()).toEqual({ error: "Too Many Requests" });
  });

  test("上限ちょうどは通す", async () => {
    expect(await check(redisReturning({ count: 5, ttl: 7 }))).toBeUndefined();
  });
});

const buildApp = (key: string, limit: number, windowSec = 60) => {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware({ keyFn: () => key, limit, windowSec }));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
};

describe("rate-limit middleware", () => {
  beforeEach(async () => {
    const redis = await getRedis();
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
