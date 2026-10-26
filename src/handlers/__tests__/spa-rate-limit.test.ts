import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { CLIENT_IP_HEADER } from "../../client-ip";
import { Effect } from "effect";
import type { Hono } from "hono";
import { buildApp } from "../../app";
import { testKvStore, testTtlStore } from "../../__tests__/test-ttl-store";
import { ATTEMPT_BUDGETS, attemptBudgetKey } from "../../attempt-budget";
import { ttlStoreLayer } from "../../ttl-store-service";
import { JSON_HEADERS } from "../client-facing-error";
import { signedIn as signedInLayer } from "../../membership/__tests__/test-layers";
import { buildAppWith } from "./helpers";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";

const ENV = { APP_ENV: "production" };
const previous = Object.entries(ENV).map(([key]) => [key, process.env[key]] as const);
beforeAll(() => {
  Object.assign(process.env, ENV);
});
afterAll(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const uniqueIp = () =>
  `2001:db8::${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}`;

const verifyFrom = (app: Hono, ip: string) =>
  app.request("/api/mfa/challenge/verify", {
    method: "POST",
    headers: { ...JSON_HEADERS, [CLIENT_IP_HEADER]: ip },
    body: JSON.stringify({ code: "000000", kind: "totp" }),
  });

const sendTimes = async (n: number, send: () => Response | Promise<Response>) => {
  const responses: Response[] = [];
  for (let i = 0; i < n; i++) responses.push(await send());
  return responses;
};

describe("MFA チャレンジの verify の試行枠 (別アカウントへの総当たりを止めるため IP ごとに 60 秒で 10 回)", () => {
  test("10 回目までは 429 にならない", async () => {
    const app = buildApp({ mountStatic: () => {} });
    const ip = uniqueIp();
    const responses = await sendTimes(10, () => verifyFrom(app, ip));
    expect(responses.map((res) => res.status).filter((s) => s === 429)).toEqual([]);
  });

  test("11 回目は 429 で、body は RateLimited、Retry-After は付けない", async () => {
    const app = buildApp({ mountStatic: () => {} });
    const ip = uniqueIp();
    const last = (await sendTimes(11, () => verifyFrom(app, ip))).at(-1) as Response;
    expect([last.status, await last.json(), last.headers.get("retry-after")]).toEqual([
      429,
      { _tag: "RateLimited" },
      null,
    ]);
  });

  test("1 回送ると、IP の key の計数が 1 になる", async () => {
    const ip = uniqueIp();
    await verifyFrom(buildApp({ mountStatic: () => {} }), ip);
    expect(testKvStore.get(attemptBudgetKey(ATTEMPT_BUDGETS.mfaChallengeVerifyPerIp, ip))).toBe(
      "1",
    );
  });

  test("TTL store で数えられない時は通す (fail-open)", async () => {
    const failingTtlStore = ttlStoreLayer({
      ...testTtlStore,
      incrementRateWindow: () => Promise.reject(new Error("ttl store down")),
    });
    const res = await verifyFrom(buildAppWith(failingTtlStore), uniqueIp());
    expect(res.status).toBe(401);
  });
});

describe("MFA チャレンジの状態の試行枠 (表示 1 回と verify 10 回を NAT の後ろの数人分見込み、IP ごとに 60 秒で 30 回)", () => {
  const stateFrom = (app: Hono, ip: string) =>
    app.request("/api/mfa/challenge", { headers: { [CLIENT_IP_HEADER]: ip } });

  test("30 回目までは 429 にならない", async () => {
    const app = buildApp({ mountStatic: () => {} });
    const ip = uniqueIp();
    const responses = await sendTimes(30, () => stateFrom(app, ip));
    expect(responses.map((res) => res.status).filter((s) => s === 429)).toEqual([]);
  });

  test("31 回目は 429", async () => {
    const app = buildApp({ mountStatic: () => {} });
    const ip = uniqueIp();
    expect((await sendTimes(31, () => stateFrom(app, ip))).at(-1)?.status).toBe(429);
  });

  test("1 回送ると、IP の key の計数が 1 になる", async () => {
    const ip = uniqueIp();
    await stateFrom(buildApp({ mountStatic: () => {} }), ip);
    expect(testKvStore.get(attemptBudgetKey(ATTEMPT_BUDGETS.mfaChallengeStatePerIp, ip))).toBe("1");
  });
});

describe("MFA の状態変更の試行枠 (session ごとに 60 秒で 10 回、enroll・activate・disable で共有)", () => {
  const { run, cleanup } = dbTest("spa-budget-");
  beforeEach(cleanup);
  afterAll(cleanup);

  const signedIn = Effect.gen(function* () {
    const user = yield* TestDb.use((db) => db.seedUser("budget"));
    const cookie = `__Secure-better-auth.session_token=${crypto.randomUUID()}`;
    return { app: buildAppWith(signedInLayer(user.id, user.email)), cookie };
  });
  const post = (app: Hono, cookie: string, path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie, "sec-fetch-site": "same-origin" },
      body: JSON.stringify(body),
    });
  const sendMixed = async (app: Hono, cookie: string, n: number) => {
    const sends = [
      () => post(app, cookie, "/api/account/mfa/enroll", {}),
      () => post(app, cookie, "/api/account/mfa/activate", { code: "000000", enrollment_id: "e" }),
      () => post(app, cookie, "/api/account/mfa/disable", { code: "000000", kind: "totp" }),
    ];
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await sends[i % sends.length]!()).status);
    return statuses;
  };

  test("合わせて 10 回目までは 429 にも 5xx にもならない", () =>
    run(
      Effect.gen(function* () {
        const { app, cookie } = yield* signedIn;
        const statuses = yield* Effect.promise(() => sendMixed(app, cookie, 10));
        expect(statuses.filter((s) => s === 429 || s >= 500)).toEqual([]);
      }),
    ));

  test("合わせて 11 回目の disable は 429 で、body は RateLimited", () =>
    run(
      Effect.gen(function* () {
        const { app, cookie } = yield* signedIn;
        yield* Effect.promise(() => sendMixed(app, cookie, 10));
        const last = yield* Effect.promise(async () =>
          post(app, cookie, "/api/account/mfa/disable", { code: "000000", kind: "totp" }),
        );
        expect([last.status, yield* Effect.promise(() => last.json())]).toEqual([
          429,
          { _tag: "RateLimited" },
        ]);
      }),
    ));
});
