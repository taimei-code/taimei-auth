import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { backfillOrphanCleanup } from "../backfill-orphan-cleanup";

const P = "backfill-test-";
const { run, cleanup } = dbTest(P);

const seedUser = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { emailVerified: false });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

const seedCompany = (suffix: string, deleted: boolean) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const id = yield* db.seedCompany(suffix);
    if (deleted) yield* db.markCompanyDeleted(id);
    return id;
  });

const join = (userId: string, companyId: string, role: "OWNER" | "ADMIN" | "MEMBER") =>
  TestDb.use((db) => db.seedMembership(userId, companyId, role));

const userExists = (id: string) =>
  TestDb.use((db) => db.readUser(id)).pipe(Effect.map((row) => row !== undefined));

const membershipCount = (companyId: string) => TestDb.use((db) => db.countMemberships(companyId));

// DELETED company に ghost membership を持つ user を 2 名作る: orphan (この事業所のみ) と survivor (別 ACTIVE 所属あり)。
const seedGhostScenario = Effect.gen(function* () {
  const deleted = yield* seedCompany("ghost", true);
  const active = yield* seedCompany("active", false);
  const orphan = yield* seedUser("orphan");
  const survivor = yield* seedUser("survivor");
  yield* join(orphan, deleted, "OWNER");
  yield* join(survivor, deleted, "MEMBER");
  yield* join(survivor, active, "MEMBER");
  return { deleted, active, orphan, survivor };
});

describe("backfillOrphanCleanup", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  // findDeletedCompanyIdsWithMemberships はグローバルクエリのため、global count ではなく
  // 自テストが作ったエンティティの振る舞いだけを検証する (他データ・残骸に左右されない)。
  test("dry-run: 対象を集計するが一切 mutate しない", () =>
    run(
      Effect.gen(function* () {
        const { deleted, orphan, survivor } = yield* seedGhostScenario;

        const report = yield* backfillOrphanCleanup({ execute: false });

        expect(report.executed).toBe(false);
        expect(report.deletedUserIds).toContain(orphan);
        expect(report.deletedUserIds).not.toContain(survivor);
        // mutate していないこと
        expect(yield* membershipCount(deleted)).toBe(2);
        expect(yield* userExists(orphan)).toBe(true);
      }),
    ));

  test("execute: ghost membership を物理削除し orphan を連動削除、survivor と ACTIVE 事業所は維持", () =>
    run(
      Effect.gen(function* () {
        const { deleted, active, orphan, survivor } = yield* seedGhostScenario;

        const report = yield* backfillOrphanCleanup({ execute: true });

        expect(report.executed).toBe(true);
        expect(report.deletedUserIds).toContain(orphan);
        expect(report.deletedUserIds).not.toContain(survivor);
        expect(yield* membershipCount(deleted)).toBe(0);
        expect(yield* userExists(orphan)).toBe(false);
        expect(yield* userExists(survivor)).toBe(true);
        expect(yield* membershipCount(active)).toBe(1);
      }),
    ));

  test("ACTIVE 事業所のメンバーは backfill 対象外で削除されない", () =>
    run(
      Effect.gen(function* () {
        const active = yield* seedCompany("only-active", false);
        const u = yield* seedUser("only");
        yield* join(u, active, "OWNER");

        const report = yield* backfillOrphanCleanup({ execute: true });

        expect(report.deletedUserIds).not.toContain(u);
        expect(yield* userExists(u)).toBe(true);
        expect(yield* membershipCount(active)).toBe(1);
      }),
    ));
});
