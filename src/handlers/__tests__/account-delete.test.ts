import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Hono } from "hono";
import { auditRowsFor, dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { mountAccountRoutes } from "../../app";
import { createSessionFor } from "../../mfa/__tests__/helpers";
import { JSON_HEADERS } from "../client-facing-error";
import { buildTestApp, requestApp, responseJson } from "./helpers";

const P = "acdel-test-";
const { run, cleanup } = dbTest(P);

const deleteAccount = (app: Hono, headers: HeadersInit) =>
  requestApp(app, "/api/account/delete", { method: "POST", headers });

describe("POST /api/account/delete", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("所属 0 件の user は 200 で削除され、account_delete を 1 行記帳する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("alone");
        expect((yield* auditRowsFor(actor.id, "account_delete")).length).toBe(0);

        const res = yield* deleteAccount(buildTestApp(actor), JSON_HEADERS);

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({ ok: true });
        expect(yield* db.readUser(actor.id)).toBeUndefined();
        expect((yield* auditRowsFor(actor.id, "account_delete")).length).toBe(1);
      }),
    ));

  test("ACTIVE な事業所の唯一の OWNER は 409 last_owner で、user は残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("sole-owner");
        const co = yield* db.seedCompany("sole");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const res = yield* deleteAccount(buildTestApp(owner), JSON_HEADERS);

        expect(res.status).toBe(409);
        expect(yield* responseJson(res)).toEqual({ error: "last_owner" });
        expect(yield* db.readUser(owner.id)).toBeDefined();
      }),
    ));

  test("Content-Type の無い cross-site の POST は 403 で、user は残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("cross-site");

        const res = yield* deleteAccount(buildTestApp(actor), { "sec-fetch-site": "cross-site" });

        expect(res.status).toBe(403);
        expect(yield* db.readUser(actor.id)).toBeDefined();
      }),
    ));

  test("Content-Type の無い same-origin の POST は削除される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("same-origin");

        const res = yield* deleteAccount(buildTestApp(actor), { "sec-fetch-site": "same-origin" });

        expect(res.status).toBe(200);
        expect(yield* db.readUser(actor.id)).toBeUndefined();
      }),
    ));

  test("退会に使った cookie のままの account API は 401 になる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actor = yield* db.seedUser("stale-cookie");
        const { headers: session } = yield* createSessionFor(actor.id);
        const app = new Hono();
        mountAccountRoutes(app);
        const memberships = () => requestApp(app, "/api/account/memberships", { headers: session });
        expect((yield* memberships()).status).toBe(200);

        const res = yield* deleteAccount(
          app,
          new Headers([...session, ...Object.entries(JSON_HEADERS)]),
        );
        expect(res.status).toBe(200);

        const after = yield* memberships();
        expect(after.status).toBe(401);
        expect(yield* responseJson(after)).toEqual({ error: "unauthorized" });
      }),
    ));
});
