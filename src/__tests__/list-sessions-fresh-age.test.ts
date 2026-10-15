import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../auth";
import { dbTest } from "./live-runner";
import { createSessionFor } from "./session-helpers";
import { TestDb } from "./test-db";
import { testKvStore } from "./test-ttl-store";

const P = "fresh-age-test-";
const { run, cleanup } = dbTest(P);
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const backdateSession = (token: string) =>
  Effect.sync(() => {
    const stored = JSON.parse(testKvStore.get(token) ?? "null");
    stored.session.createdAt = new Date(Date.now() - TWO_DAYS_MS).toISOString();
    testKvStore.set(token, JSON.stringify(stored), 60 * 60);
  });

describe("セッションの一覧は、古い session でも再認証を求めない", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("作成から 2 日経った session でも list-sessions は 200 を返す (password が無く再認証できないので freshAge を 0 にしている。0 でないと SESSION_NOT_FRESH になる)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("u1");
        const { token, headers } = yield* createSessionFor(user.id);
        yield* backdateSession(token);

        const response = yield* Effect.promise(() =>
          auth.handler(new Request("http://localhost:3000/api/auth/list-sessions", { headers })),
        );

        expect(response.status).toBe(200);
      }),
    ));
});
