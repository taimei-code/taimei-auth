import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../auth";
import { dbTest } from "./live-runner";
import { createSessionFor } from "./session-helpers";
import { TestDb } from "./test-db";

const P = "session-list-delete-test-";
const { run, cleanup } = dbTest(P);

describe("session の一覧は、項目を消さずに合わせても、消した session を出さない", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("2 つのうち 1 つの session を消すと、一覧には一覧の項目が残っても、消していない session だけが出る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("u1");
        const kept = yield* createSessionFor(user.id);
        const removed = yield* createSessionFor(user.id);

        const listed = yield* Effect.promise(async () => {
          const context = await auth.$context;
          await context.internalAdapter.deleteSession(removed.token);
          return context.internalAdapter.listSessions(user.id);
        });

        expect(listed.map(({ token }) => token)).toEqual([kept.token]);
      }),
    ));
});
