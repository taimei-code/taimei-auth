import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AuthApiError } from "../../errors";
import { dbTest } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { authApiWith } from "../../__tests__/test-layers";
import { TestDb } from "../../__tests__/test-db";
import { createSessionFor, sessionUserIdOf } from "../../mfa/__tests__/helpers";
import { deleteSessionsOf } from "../delete-sessions";

const P = "delsess-test-";
const { run, cleanup } = dbTest(P);

const failingFor = (failingUserId: string) =>
  authApiWith((live) => ({
    deleteUserSessions: (userId) =>
      userId === failingUserId
        ? new AuthApiError({ cause: "ttl store down" })
        : live.deleteUserSessions(userId),
  }));

describe("deleteSessionsOf", () => {
  const sentry = recordSentryExceptions();
  beforeEach(cleanup);
  afterAll(cleanup);

  test("1 人の TTL store の失敗は経路と userId を付けて Sentry に記録し、残りの user の session は消して成功する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const failing = yield* db.seedUser("failing");
        const other = yield* db.seedUser("other");
        const failingSession = yield* createSessionFor(failing.id);
        const otherSession = yield* createSessionFor(other.id);
        expect(yield* sessionUserIdOf(otherSession.headers)).toBe(other.id);
        sentry.length = 0;

        yield* deleteSessionsOf([failing.id, other.id], "company-delete").pipe(
          Effect.provide(failingFor(failing.id)),
        );

        expect(yield* sessionUserIdOf(otherSession.headers)).toBeUndefined();
        expect(yield* sessionUserIdOf(failingSession.headers)).toBe(failing.id);
        expect(sentry.map(([error, context]) => [error, context?.tags, context?.extra])).toEqual([
          [
            "ttl store down",
            { component: "deleteAccount", flow: "company-delete" },
            { userId: failing.id },
          ],
        ]);
      }),
    ));
});
