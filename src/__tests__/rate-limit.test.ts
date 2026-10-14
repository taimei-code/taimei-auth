import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono } from "hono";
import { buildApp as buildServerApp } from "../app";
import { CONTINUE, type MiddlewareDecision } from "../handlers/run-route";
import {
  createRateLimitMiddleware,
  magicLinkKey,
  mfaAttemptKey,
  rateLimitProgram,
} from "../rate-limit";
import { toRateWindowResult } from "../ttl-store";
import type { TtlStore } from "../ttl-store-service";
import { type SentryService, SentryLive } from "../sentry";
import { recordSentryExceptions } from "./sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "./test-layers";
import { testKvStore } from "./test-ttl-store";

rateLimitProgram satisfies (input: {
  key: string;
  limit: number;
  windowSec: number;
}) => Effect.Effect<MiddlewareDecision, never, TtlStore | SentryService>;

describe("rateLimitProgram (TTL store 無し)", () => {
  const captured = recordSentryExceptions();
  const check = (ttlStore: Layer.Layer<TtlStore>) =>
    Effect.runPromise(
      Effect.provide(
        rateLimitProgram({ key: "rate-limit:test:stub", limit: 5, windowSec: 60 }),
        Layer.mergeAll(ttlStore, SentryLive),
      ),
    );

  test("計数不能 (TtlStoreError) は fail-open で通し、Sentry に rate-limit / warning を 1 回記録する", async () => {
    const before = captured.length;
    expect(await check(failingTtlStoreLayer)).toEqual(CONTINUE);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("rate-limit");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("上限 + 1 は 429 で Retry-After は windowSec", async () => {
    const decision = await check(ttlStoreReturning({ count: 6 }));
    if (decision._tag !== "Respond") throw new Error(`expected Respond, got ${decision._tag}`);
    const res = decision.response;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json<unknown>()).toEqual({ error: "Too Many Requests" });
  });

  test("上限ちょうどは通す", async () => {
    expect(await check(ttlStoreReturning({ count: 5 }))).toEqual(CONTINUE);
  });
});

const buildApp = (key: string, limit: number, windowSec = 60) => {
  const app = new Hono();
  app.use("*", createRateLimitMiddleware({ keyFn: () => key, limit, windowSec }));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
};

describe("rate-limit middleware", () => {
  beforeEach(() => {
    for (const key of testKvStore.keys("rate-limit:test:")) testKvStore.delete(key);
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

describe("magic link の送信の試行枠 (IP ごとに 60 秒で 5 回)", () => {
  const ENV = { APP_ENV: "production", AUTH_TRUSTED_PROXY_HOPS: "1" };
  const previous = Object.keys(ENV).map((key) => [key, process.env[key]] as const);
  beforeAll(() => {
    Object.assign(process.env, ENV);
  });
  afterAll(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("同じ IP で 5 回数えた後の 6 回目は、メールを送る前に 429 で Retry-After は 60", async () => {
    const ip = `2001:db8::${crypto.randomUUID().slice(0, 4)}`;
    testKvStore.set(magicLinkKey("ip", ip), "5", 60);
    const res = await buildServerApp({ mountStatic: () => {} }).request(
      "/api/auth/sign-in/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "rate-limit@example.com" }),
      },
    );
    expect([res.status, res.headers.get("retry-after")]).toEqual([429, "60"]);
  });
});

describe("MFA の試行枠の key", () => {
  test("session 軸の key は IP を変えても同じ枠で、cookie の値を key 名に含めない (key 名を認証情報にしない)", async () => {
    const headers = new Headers({ cookie: "better-auth.session_token=tok.sig" });
    const fromOneIp = await mfaAttemptKey(headers, "203.0.113.1");
    const fromAnotherIp = await mfaAttemptKey(headers, "198.51.100.2");
    expect(fromOneIp).toBe(fromAnotherIp);
    expect(fromOneIp).toStartWith("rate-limit:mfa-attempt:session:");
    expect(fromOneIp).not.toContain("tok");
  });
});

test.each([
  0,
  -1,
  Number.NaN,
])("TTL store の計数 %p は throw する (0 を返すと fail-open 側の試行枠が storage 障害を「通す」扱いにする)", (count) => {
  expect(() => toRateWindowResult(count)).toThrow();
});
