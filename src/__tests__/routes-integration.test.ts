import { describe, expect, test } from "bun:test";
import { requestApp } from "../handlers/__tests__/helpers";
import { Effect } from "effect";
import { app } from "../index";
import { getMemoryKvStore } from "../ttl-store";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

const P = "enum-test-";
const { run } = dbTest(P);
const request = (url: string, init?: RequestInit) => requestApp(app, url, init);

// Hono v4 では `/api/auth/**` が入れ子の path に一致しない。`/api/auth/*` を使う (#52)。
describe("Hono /api/auth/* route registration (regression for #52)", () => {
  test("GET /api/auth/ok returns 200 (Better Auth health endpoint reachable)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/ok");
        expect(res.status).toBe(200);
      }),
    ));

  test("POST /api/auth/sign-in/magic-link is registered (not 404)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "regression-test@example.com" }),
        });
        expect(res.status).not.toBe(404);
      }),
    ));

  test("GET /api/auth/get-session is registered (not 404)", () =>
    run(
      Effect.gen(function* () {
        const res = yield* request("http://localhost/api/auth/get-session");
        expect(res.status).not.toBe(404);
      }),
    ));
});

describe("Magic Link rate-limit local 緩和 (regression for #53)", () => {
  test("APP_ENV=development で 10 連続送信が 429 にならない", () =>
    run(
      Effect.gen(function* () {
        // APP_ENV は module の top-level で確定するので、ここで stub しても反映されない。
        const statuses: number[] = [];
        for (let i = 0; i < 10; i++) {
          const res = yield* request("http://localhost/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: `regression-rate-${i}@example.com` }),
          });
          statuses.push(res.status);
        }

        const rateLimited = statuses.filter((s) => s === 429);
        expect(rateLimited.length).toBe(0);
      }),
    ));
});

describe("MFA チャレンジ状態取得の rate limit 登録 (ADR-0013)", () => {
  // 429 で確認しない (local の緩和値では到達しない)。
  const windowCount = (key: string) => Effect.sync(() => Number(getMemoryKvStore().get(key) ?? 0));

  // IP literal 以外は unknown として窓を共有する (request-context.ts) ので、下位 2 octet を乱数にする。
  const isolatedClientIp = (): string =>
    `203.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

  test("状態取得が IP 軸の枠を消費する", () =>
    run(
      Effect.gen(function* () {
        const ip = isolatedClientIp();

        const res = yield* request("http://localhost/api/mfa/challenge", {
          headers: { "x-forwarded-for": ip },
        });

        expect(res.status).toBe(200);
        expect(yield* windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(1);
      }),
    ));

  test("状態取得は verify の枠を消費しない", () =>
    run(
      Effect.gen(function* () {
        const ip = isolatedClientIp();

        for (let i = 0; i < 3; i++) {
          yield* request("http://localhost/api/mfa/challenge", {
            headers: { "x-forwarded-for": ip },
          });
        }

        expect(yield* windowCount(`rate-limit:mfa-challenge-status:ip:${ip}`)).toBe(3);
        expect(yield* windowCount(`rate-limit:mfa-challenge:ip:${ip}`)).toBe(0);
      }),
    ));
});

describe("Magic Link の user enumeration 防止 (ADR-0007)", () => {
  test("未登録 email と登録済 email で status と body 形状が一致する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        yield* db.cleanup();
        yield* db.seedUser("registered", { name: "Enum Registered" });

        const send = (email: string) =>
          request("http://localhost/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          });

        const registered = yield* send(`${P}registered@example.com`);
        const unregistered = yield* send(`${P}unregistered@example.com`);

        expect(registered.status).toBe(unregistered.status);
        const registeredBody = yield* Effect.promise(() => registered.json());
        const unregisteredBody = yield* Effect.promise(() => unregistered.json());
        expect(Object.keys(registeredBody as object).sort()).toEqual(
          Object.keys(unregisteredBody as object).sort(),
        );
        expect(registeredBody).toEqual(unregisteredBody);

        yield* db.cleanup();
      }),
    ));
});
