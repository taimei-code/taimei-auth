import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { requireRecentSignIn } from "../reauthentication";

const { run, cleanup } = dbTest("reauthentication-test-");

const ISSUED_AT = new Date("2026-11-24T00:00:00.000Z");
const TEN_MINUTES_MS = 10 * 60 * 1000;

const requireAt = (userId: string, elapsedMs: number) =>
  Effect.gen(function* () {
    setSystemTime(new Date(ISSUED_AT.getTime() + elapsedMs));
    return yield* Effect.exit(
      requireRecentSignIn({
        actor: { id: userId },
        session: { issuedAt: ISSUED_AT },
        operation: "mfa_enroll",
        headers: new Headers(),
      }),
    );
  });

describe("再認証の時間窓", () => {
  beforeEach(cleanup);
  afterEach(() => setSystemTime());
  afterAll(cleanup);

  test("session の発行からちょうど 10 分は再認証を済んだものとして通す", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("boundary-in"));

        const exit = yield* requireAt(user.id, TEN_MINUTES_MS);

        expect(exit._tag).toBe("Success");
      }),
    ));

  test("session の発行から 10 分と 1 ミリ秒経つと ReauthenticationRequired で拒む", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("boundary-out"));

        const failure = yield* requireAt(user.id, TEN_MINUTES_MS + 1).pipe(
          Effect.flatMap((exit) => exit),
          Effect.flip,
        );

        expect(failure._tag).toBe("ReauthenticationRequired");
      }),
    ));
});
