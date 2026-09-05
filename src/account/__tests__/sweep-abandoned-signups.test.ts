import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
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

// signup 登録途中放棄 (古い 0 件) / 直近 signup (新しい 0 件) / 所属あり (古いが ACTIVE 所属) を作る。
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
        expect(yield* userExists(oldOrphan)).toBe(true); // mutate していない
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
