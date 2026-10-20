import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { Hono } from "hono";
import { buildApp as buildServerApp } from "../app";
import { ATTEMPT_BUDGETS, type AttemptBudget, attemptBudgetKey } from "../attempt-budget";
import { attemptBudgetMiddleware, attemptBudgetProgram } from "../handlers/attempt-budget-hono";
import { mfaAttemptSubject } from "../handlers/attempt-budget-http-api";
import { CONTINUE, type MiddlewareDecision } from "../handlers/run-route";
import { RateLimited } from "../failures";
import { toRateWindowResult } from "../ttl-store";
import type { TtlStore } from "../ttl-store-service";
import { type SentryService, SentryLive } from "../sentry";
import { recordSentry } from "./sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "./test-layers";
import { testKvStore } from "./test-ttl-store";

attemptBudgetProgram satisfies (
  budget: AttemptBudget<"allow">,
  subject: string,
) => Effect.Effect<MiddlewareDecision, RateLimited, TtlStore | SentryService>;

const TEST_KEY_PREFIX = "attempt-budget-test";

const budgetOf = (limit: number): AttemptBudget<"allow"> => ({
  keyPrefix: TEST_KEY_PREFIX,
  windowSeconds: 60,
  maxAttempts: () => limit,
  whenUncountable: "allow",
  component: "rate-limit",
});

describe("attemptBudgetProgram (TTL store 無し)", () => {
  const { exceptions: captured } = recordSentry();
  const check = (ttlStore: Layer.Layer<TtlStore>, budget: AttemptBudget<"allow"> = budgetOf(5)) =>
    Effect.runPromise(
      Effect.provide(attemptBudgetProgram(budget, "stub"), Layer.mergeAll(ttlStore, SentryLive)),
    );

  test("計数不能 (TtlStoreError) は fail-open で通し、Sentry に rate-limit / warning を 1 回記録する", async () => {
    const before = captured.length;
    expect(await check(failingTtlStoreLayer, ATTEMPT_BUDGETS.magicLinkPerIp)).toEqual(CONTINUE);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("rate-limit");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("上限 + 1 は SPA の API と同じ RateLimited で失敗する", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        attemptBudgetProgram(budgetOf(5), "stub"),
        Layer.mergeAll(ttlStoreReturning({ count: 6 }), SentryLive),
      ),
    );
    expect(exit).toEqual(Exit.fail(new RateLimited()));
  });

  test("上限ちょうどは通す", async () => {
    expect(await check(ttlStoreReturning({ count: 5 }))).toEqual(CONTINUE);
  });
});

const buildApp = (subject: string, limit: number) => {
  const app = new Hono();
  app.use(
    "*",
    attemptBudgetMiddleware(budgetOf(limit), () => subject),
  );
  app.get("/", (c) => c.json({ ok: true }));
  return app;
};

describe("attemptBudgetMiddleware", () => {
  beforeEach(() => {
    for (const key of testKvStore.keys(`${TEST_KEY_PREFIX}:`)) testKvStore.delete(key);
  });

  test("limit 5 で 6 req 目に 429", async () => {
    const app = buildApp("fixed", 5);
    for (let i = 0; i < 5; i++) {
      const res = await app.request("http://localhost/");
      expect(res.status).toBe(200);
    }
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(429);
  });

  test("limit 1 で 2 req 目に 429", async () => {
    const app = buildApp("small-limit", 1);
    const withinLimit = await app.request("http://localhost/");
    expect(withinLimit.status).toBe(200);
    const overLimit = await app.request("http://localhost/");
    expect(overLimit.status).toBe(429);
  });

  test("異なる subject は独立 (A の計数は B に影響しない)", async () => {
    const appA = buildApp("A", 1);
    const appB = buildApp("B", 1);
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

  test("同じ IP で 5 回数えた後の 6 回目は、メールを送る前に 429 の RateLimited を返し、Retry-After を付けない", async () => {
    const ip = `2001:db8::${crypto.randomUUID().slice(0, 4)}`;
    testKvStore.set(attemptBudgetKey(ATTEMPT_BUDGETS.magicLinkPerIp, ip), "5", 60);
    const res = await buildServerApp({ mountStatic: () => {} }).request(
      "/api/auth/sign-in/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ email: "rate-limit@example.com" }),
      },
    );
    expect([res.status, res.headers.get("retry-after")]).toEqual([429, null]);
    expect(await res.json<unknown>()).toEqual({ _tag: "RateLimited" });
  });
});

describe("MFA の試行枠の subject", () => {
  test("session 軸の subject は IP を変えても同じ枠で、cookie の値を鍵に含めない (鍵を認証情報にしない)", async () => {
    const headers = new Headers({ cookie: "better-auth.session_token=tok.sig" });
    const fromOneIp = await mfaAttemptSubject(headers, "203.0.113.1");
    const fromAnotherIp = await mfaAttemptSubject(headers, "198.51.100.2");
    expect(fromOneIp).toBe(fromAnotherIp);
    expect(fromOneIp).toStartWith("session:");
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
