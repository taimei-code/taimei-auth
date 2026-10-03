import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, Ref } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { failingSessionDeletion } from "../../__tests__/test-layers";
import { storedSessionOf, storedSessionsOf } from "../../__tests__/test-ttl-store";
import { DbError } from "../../errors";
import { MembershipRepo } from "../../membership/ports";
import { MembershipRepoLive } from "../../membership/wiring";
import { createSessionFor } from "../../mfa/__tests__/helpers";
import { UserRepo } from "../ports";
import { UserRepoLive } from "../wiring";
import { sweepAbandonedSignups } from "../sweep-abandoned-signups";

const TTL_MS = 24 * 60 * 60 * 1000;
const P = "sweep-test-";
const { run, cleanup } = dbTest(P);

const seedUserAt = (suffix: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { emailVerified: false, createdAt });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

const userExists = (id: string) =>
  TestDb.use((db) => db.readUser(id)).pipe(Effect.map((row) => row !== undefined));

const seedScenario = Effect.gen(function* () {
  const db = yield* TestDb;
  const old = new Date(Date.now() - 2 * TTL_MS);
  const oldOrphan = yield* seedUserAt("old-orphan", old);
  const recentOrphan = yield* seedUserAt("recent-orphan", new Date());
  const oldWithCompany = yield* seedUserAt("old-withco", old);
  const companyId = yield* db.seedCompany("withco");
  yield* db.seedMembership(oldWithCompany, companyId, "OWNER");
  return { oldOrphan, recentOrphan, oldWithCompany };
});

describe("sweepAbandonedSignups", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("dry-run: 24h 超過 + 所属 0 件のみ候補に挙げ mutate しない", () =>
    run(
      Effect.gen(function* () {
        const { oldOrphan, recentOrphan, oldWithCompany } = yield* seedScenario;

        const report = yield* sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: false });

        expect(report.executed).toBe(false);
        expect(report.deletedUserIds).toContain(oldOrphan);
        expect(report.deletedUserIds).not.toContain(recentOrphan);
        expect(report.deletedUserIds).not.toContain(oldWithCompany);
        expect(yield* userExists(oldOrphan)).toBe(true); // 何も変更していない
      }),
    ));

  test("execute: 古い orphan を削除し、24h 内 / 所属あり は残す", () =>
    run(
      Effect.gen(function* () {
        const { oldOrphan, recentOrphan, oldWithCompany } = yield* seedScenario;

        const report = yield* sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: true });

        expect(report.executed).toBe(true);
        expect(report.deletedUserIds).toContain(oldOrphan);
        expect(report.deletedUserIds).not.toContain(recentOrphan);
        expect(yield* userExists(oldOrphan)).toBe(false);
        expect(yield* userExists(recentOrphan)).toBe(true);
        expect(yield* userExists(oldWithCompany)).toBe(true);
      }),
    ));
});

describe("sweepAbandonedSignups の TTL store の session 削除", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  const seedWithSessions = Effect.gen(function* () {
    const ids = yield* seedScenario;
    const sessions = yield* Effect.forEach(
      [ids.oldOrphan, ids.recentOrphan, ids.oldWithCompany],
      (userId) => Effect.map(createSessionFor(userId), ({ token }) => ({ userId, token })),
    );
    return { ids, sessions };
  });

  test("execute: 削除した user の session と索引だけが消える", () =>
    run(
      Effect.gen(function* () {
        const { sessions } = yield* seedWithSessions;

        yield* sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: true });

        expect(yield* storedSessionsOf(sessions)).toEqual([
          { session: false, index: false },
          { session: true, index: true },
          { session: true, index: true },
        ]);
      }),
    ));

  test("dry-run: どの session と索引も残る", () =>
    run(
      Effect.gen(function* () {
        const { sessions } = yield* seedWithSessions;

        yield* sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: false });

        expect(yield* storedSessionsOf(sessions)).toEqual([
          { session: true, index: true },
          { session: true, index: true },
          { session: true, index: true },
        ]);
      }),
    ));

  test("execute: TTL store の削除は user 行が消えた後に呼ばれる", () =>
    run(
      Effect.gen(function* () {
        const { ids } = yield* seedWithSessions;
        const failing = yield* failingSessionDeletion;

        const report = yield* sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: true }).pipe(
          Effect.provide(failing.layer),
        );

        expect(report.deletedUserIds).toContain(ids.oldOrphan);
        expect(yield* Ref.get(failing.userRowPresentAtCall)).toEqual(
          report.deletedUserIds.map(() => false),
        );
      }),
    ));
});

describe("sweepAbandonedSignups の途中の失敗", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("後の候補の tx が失敗しても、先に削除を commit した user の session と索引は消えている", () =>
    run(
      Effect.gen(function* () {
        const old = new Date(Date.now() - 2 * TTL_MS);
        const first = yield* seedUserAt("first", old);
        const second = yield* seedUserAt("second", old);
        const firstSession = yield* createSessionFor(first);
        const candidatesInOrder = Layer.effect(
          UserRepo,
          Effect.map(UserRepo, (live) =>
            UserRepo.of({
              ...live,
              findAbandonedSignupUserIds: () => Effect.succeed([first, second]),
            }),
          ),
        ).pipe(Layer.provide(UserRepoLive));
        const failingForSecond = Layer.effect(
          MembershipRepo,
          Effect.map(MembershipRepo, (live) =>
            MembershipRepo.of({
              ...live,
              countActiveMembershipsByUserId: (userId, tx) =>
                userId === second
                  ? new DbError({ cause: "db down" })
                  : live.countActiveMembershipsByUserId(userId, tx),
            }),
          ),
        ).pipe(Layer.provide(MembershipRepoLive));

        const exit = yield* Effect.exit(
          sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: true }).pipe(
            Effect.provide(Layer.mergeAll(candidatesInOrder, failingForSecond)),
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* userExists(first)).toBe(false);
        expect(yield* storedSessionOf(first, firstSession.token)).toEqual({
          session: false,
          index: false,
        });
      }),
    ));
});
