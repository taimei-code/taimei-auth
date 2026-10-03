import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { runTest, inTx } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { auditLogWith, holdBeforeCommit } from "../../__tests__/test-layers";
import { addCompany } from "../../company/create";
import { removeMember } from "../../membership/remove";
import { deleteAccountIfOrphaned } from "../orphan";
import { storedSessionOf } from "../../__tests__/test-ttl-store";
import { createSessionFor } from "../../mfa/__tests__/helpers";

const P = "orphan-test-";
const run = runTest(P);

const cleanup = () => run(TestDb.use((db) => db.cleanup()));

const seedUser = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { emailVerified: false });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

const countAccountDeleteAudit = (userId: string) =>
  TestDb.use((db) => db.readAuditRows(userId, "account_delete")).pipe(
    Effect.map((rows) => rows.length),
  );

describe("deleteAccountIfOrphaned", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("active membership 0 件なら account を削除し session 消滅 + audit を残す (true)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("orphan");

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* db.readUser(userId)).toBeUndefined();
        expect((yield* db.readSessions(userId)).length).toBe(0); // user の cascade で物理削除される
        expect(yield* countAccountDeleteAudit(userId)).toBe(1);
      }),
    ));

  test("active membership が残るなら削除しない (false)、account 維持", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("kept");
        const companyId = yield* db.seedCompany("kept");
        yield* db.seedMembership(userId, companyId, "OWNER");

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(false);
        expect(yield* db.readUser(userId)).toBeDefined();
        expect(yield* countAccountDeleteAudit(userId)).toBe(0);
      }),
    ));

  test("DELETED company の残存 membership だけなら orphan 扱いで削除 (true)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("ghost");
        const companyId = yield* db.seedCompany("ghost");
        yield* db.seedMembership(userId, companyId, "OWNER");
        yield* db.markCompanyDeleted(companyId);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* db.readUser(userId)).toBeUndefined();
      }),
    ));

  test("存在しない user には何もせず false を返し、記帳しない", () =>
    run(
      Effect.gen(function* () {
        const userId = `${P}u-absent`;

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(false);
        expect(yield* countAccountDeleteAudit(userId)).toBe(0);
      }),
    ));

  test("削除する user と残す user のどちらでも、tx の中では TTL store の session に触れない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const orphanId = yield* seedUser("store-orphan");
        const keptId = yield* seedUser("store-kept");
        yield* db.seedMembership(keptId, yield* db.seedCompany("store-kept"), "OWNER");
        const orphanSession = yield* createSessionFor(orphanId);
        const keptSession = yield* createSessionFor(keptId);

        const deleted = yield* inTx((tx) =>
          Effect.all([deleteAccountIfOrphaned(orphanId, tx), deleteAccountIfOrphaned(keptId, tx)]),
        );

        expect(deleted).toEqual([true, false]);
        const both = { session: true, index: true };
        expect(yield* storedSessionOf(orphanId, orphanSession.token)).toEqual(both);
        expect(yield* storedSessionOf(keptId, keptSession.token)).toEqual(both);
      }),
    ));
});

const addCompanyPausedBeforeCommit = (userId: string, name: string) =>
  Effect.gen(function* () {
    const written = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const adding = addCompany(userId, { name: `${P}${name}`, orgCode: "PERSONAL" }).pipe(
      Effect.provide(
        auditLogWith((live) => ({
          recordCompanyCreated: (...args) =>
            holdBeforeCommit(written, release)(live.recordCompanyCreated(...args)),
        })),
      ),
    );
    const releaseShortlyAfterWrite = Deferred.await(written).pipe(
      Effect.andThen(Effect.sleep("50 millis")),
      Effect.andThen(Deferred.succeed(release, undefined)),
    );
    return { adding, written, releaseShortlyAfterWrite };
  });

describe("orphan の判定と事業所追加の競合", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("最後の所属を除名される user が事業所を追加中なら、追加の commit を待って数え、user と追加した事業所の OWNER が残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("race-owner");
        const member = yield* db.seedUser("race-member");
        const company = yield* db.seedCompany("race-x");
        yield* db.seedMembership(owner.id, company, "OWNER");
        yield* db.seedMembership(member.id, company, "MEMBER");
        const { adding, written, releaseShortlyAfterWrite } = yield* addCompanyPausedBeforeCommit(
          member.id,
          "race-y",
        );
        const removal = Deferred.await(written).pipe(
          Effect.andThen(
            removeMember({
              actorUserId: owner.id,
              targetUserId: member.id,
              companyId: company,
              targetRole: "MEMBER",
            }),
          ),
        );

        const [added, removed] = yield* Effect.all([adding, removal, releaseShortlyAfterWrite], {
          concurrency: "unbounded",
        });

        expect(removed).toEqual({ accountDeleted: false });
        expect(yield* db.readUser(member.id)).toBeDefined();
        expect((yield* db.readMembership(member.id, added.company.id))?.role).toBe("OWNER");
      }),
    ));

  test("所属 0 件の user が事業所を追加中なら、追加の commit を待って数え、user と追加した事業所の OWNER が残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("sweep-race");
        const { adding, written, releaseShortlyAfterWrite } = yield* addCompanyPausedBeforeCommit(
          userId,
          "sweep-race-y",
        );
        const orphanCheck = Deferred.await(written).pipe(
          Effect.andThen(inTx((tx) => deleteAccountIfOrphaned(userId, tx))),
        );

        const [added, deleted] = yield* Effect.all(
          [adding, orphanCheck, releaseShortlyAfterWrite],
          {
            concurrency: "unbounded",
          },
        );

        expect(deleted).toBe(false);
        expect(yield* db.readUser(userId)).toBeDefined();
        expect((yield* db.readMembership(userId, added.company.id))?.role).toBe("OWNER");
      }),
    ));

  test("orphan として削除された後の user の事業所追加は失敗し、事業所の行を残さない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("gone");
        expect(yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx))).toBe(true);

        const exit = yield* Effect.exit(
          addCompany(userId, { name: `${P}gone-co`, orgCode: "PERSONAL" }),
        );

        expect(exit._tag).toBe("Failure");
        expect(yield* db.readCompanyIdsByName(`${P}gone-co`)).toEqual([]);
      }),
    ));
});
