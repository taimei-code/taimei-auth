import { describe, expect, test } from "bun:test";
import { requestApp, responseJson } from "../../src/handlers/__tests__/helpers";
import { createSessionFor } from "../../src/__tests__/session-helpers";
import { Effect } from "effect";
import { startBunServer } from "../bun-server";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { testKvStore } from "../../src/__tests__/test-ttl-store";

const { app } = startBunServer();

const P = "enum-test-";
const { run } = dbTest(P);
const request = (url: string, init?: RequestInit) => requestApp(app, url, init);

describe("Hono /api/auth/* route registration (Hono v4 の /** は入れ子の path に一致しないので /* で登録する)", () => {
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

describe("MFA チャレンジ状態取得の rate limit 登録 (ADR-0013)", () => {
  const windowCount = (key: string) => Effect.sync(() => Number(testKvStore.get(key) ?? 0));

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

describe("better-auth の退会 endpoint", () => {
  test("有効な session でも POST /api/auth/delete-user は 404 で、user は残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        yield* db.cleanup();
        const user = yield* db.seedUser("ba-delete");
        const { headers: session } = yield* createSessionFor(user.id);
        const current = yield* request("http://localhost/api/auth/get-session", {
          headers: session,
        });
        expect(((yield* responseJson(current)) as { user: { id: string } }).user.id).toBe(user.id);

        const res = yield* request("http://localhost/api/auth/delete-user", {
          method: "POST",
          headers: new Headers([
            ...session,
            ["content-type", "application/json"],
            ["origin", "http://localhost"],
          ]),
          body: "{}",
        });

        expect(res.status).toBe(404);
        expect(yield* db.readUser(user.id)).toBeDefined();
        yield* db.cleanup();
      }),
    ));
});
