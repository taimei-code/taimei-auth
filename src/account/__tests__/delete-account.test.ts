import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Layer, Ref } from "effect";
import { AuditLog } from "../../audit/ports";
import { AuditLogLive } from "../../audit/wiring";
import { AuthApi } from "../../auth-service";
import { auditRowsFor, dbTest, expectFailure } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { createSessionFor } from "../../mfa/__tests__/helpers";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { AuthApiError } from "../../errors";
import { LastOwner } from "../../membership/errors";
import { MembershipRepo } from "../../membership/ports";
import { MembershipRepoLive } from "../../membership/wiring";
import { NotFound } from "../../membership/guard/errors";
import { transferOwnership } from "../../membership/transfer-ownership";
import { addCompany } from "../../company/create";
import { deleteAccountUnlessLastOwner } from "../delete-account";
import { UserRepo } from "../ports";
import { UserRepoLive } from "../wiring";

const P = "delacc-test-";
const { run, cleanup } = dbTest(P);

const ownerIdsOf = (companyId: string) =>
  TestDb.use((db) => db.readMembershipsOfCompany(companyId)).pipe(
    Effect.map((rows) => rows.filter((m) => m.role === "OWNER").map((m) => m.userId)),
  );

const sessionUserId = (headers: Headers) =>
  AuthApi.use((authApi) => authApi.getSession(headers)).pipe(
    Effect.map((session) => session?.user.id),
  );

describe("deleteAccountUnlessLastOwner", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("所属 0 件の user は削除され、account_delete を 1 行記帳する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("alone");
        expect(yield* db.readUser(user.id)).toBeDefined();
        expect((yield* auditRowsFor(user.id, "account_delete")).length).toBe(0);

        yield* deleteAccountUnlessLastOwner(user.id);

        expect(yield* db.readUser(user.id)).toBeUndefined();
        expect((yield* auditRowsFor(user.id, "account_delete")).length).toBe(1);
      }),
    ));

  test("削除すると session が DB と TTL store の両方から消える", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("signed-in");
        const { headers } = yield* createSessionFor(user.id);
        expect(yield* sessionUserId(headers)).toBe(user.id);

        yield* deleteAccountUnlessLastOwner(user.id);

        expect(yield* sessionUserId(headers)).toBeUndefined();
        expect(yield* db.readSessions(user.id)).toEqual([]);
      }),
    ));

  test("ACTIVE な事業所の唯一の OWNER は last_owner で拒否され、user と所属と audit は変わらない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("sole-owner");
        const co = yield* db.seedCompany("sole");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const before = yield* db.readMemberships(owner.id);

        const error = yield* Effect.flip(deleteAccountUnlessLastOwner(owner.id));

        expectFailure(error, LastOwner, "last_owner", 409);
        expect(yield* db.readUser(owner.id)).toBeDefined();
        expect(yield* db.readMemberships(owner.id)).toEqual(before);
        expect((yield* auditRowsFor(owner.id, "account_delete")).length).toBe(0);
      }),
    ));

  test("OWNER が 2 人いる事業所の OWNER は削除され、もう 1 人の OWNER が残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const leaving = yield* db.seedUser("co-owner-leaving");
        const staying = yield* db.seedUser("co-owner-staying");
        const co = yield* db.seedCompany("co-owned");
        yield* db.seedMembership(leaving.id, co, "OWNER");
        yield* db.seedMembership(staying.id, co, "OWNER");

        yield* deleteAccountUnlessLastOwner(leaving.id);

        expect(yield* db.readUser(leaving.id)).toBeUndefined();
        expect(yield* ownerIdsOf(co)).toEqual([staying.id]);
      }),
    ));

  test("DELETED な事業所の唯一の OWNER は削除される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("deleted-co-owner");
        const co = yield* db.seedCompany("deleted-co");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.markCompanyDeleted(co);

        yield* deleteAccountUnlessLastOwner(owner.id);

        expect(yield* db.readUser(owner.id)).toBeUndefined();
      }),
    ));

  test("唯一の OWNER が別にいる事業所の ADMIN は削除され、OWNER は変わらない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("admin-co-owner");
        const admin = yield* db.seedUser("admin-leaving");
        const co = yield* db.seedCompany("admin-co");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(admin.id, co, "ADMIN");

        yield* deleteAccountUnlessLastOwner(admin.id);

        expect(yield* db.readUser(admin.id)).toBeUndefined();
        expect(yield* ownerIdsOf(co)).toEqual([owner.id]);
      }),
    ));

  test("存在しない user は not_found で、account_delete を記帳しない", () =>
    run(
      Effect.gen(function* () {
        const absent = `${P}absent`;

        const error = yield* Effect.flip(deleteAccountUnlessLastOwner(absent));

        expectFailure(error, NotFound, "not_found", 404);
        expect((yield* auditRowsFor(absent, "account_delete")).length).toBe(0);
      }),
    ));
});

const slowUserDelete = Layer.effect(
  UserRepo,
  Effect.map(UserRepo, (live) =>
    UserRepo.of({
      ...live,
      deleteUser: (...args) =>
        Effect.sleep("100 millis").pipe(Effect.andThen(live.deleteUser(...args))),
    }),
  ),
).pipe(Layer.provide(UserRepoLive));

describe("退会と OWNER の race (不安定な失敗を検知するため 5 回繰り返す)", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  for (let i = 1; i <= 5; i++) {
    test(`iteration ${i}: 共同 OWNER 2 人の同時退会は片方だけ成功し、もう片方は last_owner で OWNER が 1 人残る`, () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const co = yield* db.seedCompany(`race-${i}`);
          const owners = [yield* db.seedUser(`race-${i}-1`), yield* db.seedUser(`race-${i}-2`)];
          for (const o of owners) yield* db.seedMembership(o.id, co, "OWNER");

          const results = yield* Effect.all(
            owners.map((o) => Effect.exit(deleteAccountUnlessLastOwner(o.id))),
            { concurrency: "unbounded" },
          ).pipe(Effect.provide(slowUserDelete));

          const failed = results.filter(Exit.isFailure);
          expect(failed.length).toBe(1);
          expectFailure(yield* Effect.flip(failed[0] ?? Exit.void), LastOwner, "last_owner", 409);
          const remaining = yield* db.readMembershipsOfCompany(co);
          expect(remaining.map((m) => m.role)).toEqual(["OWNER"]);
        }),
      ));
  }
});

const holdBeforeCommit =
  (written: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
  <A, E>(write: Effect.Effect<A, E>) =>
    write.pipe(
      Effect.tap(() => Deferred.succeed(written, undefined)),
      Effect.tap(() => Deferred.await(release)),
    );

const auditLogWith = (override: (live: AuditLog["Service"]) => Partial<AuditLog["Service"]>) =>
  Layer.effect(
    AuditLog,
    Effect.map(AuditLog, (live) => AuditLog.of({ ...live, ...override(live) })),
  ).pipe(Layer.provide(AuditLogLive));

const signalLockRequest = (lockRequested: Deferred.Deferred<void>) =>
  Layer.effect(
    MembershipRepo,
    Effect.map(MembershipRepo, (live) =>
      MembershipRepo.of({
        ...live,
        lockOwnerMembershipsOfUserCompanies: (...args) =>
          Deferred.succeed(lockRequested, undefined).pipe(
            Effect.andThen(live.lockOwnerMembershipsOfUserCompanies(...args)),
          ),
      }),
    ),
  ).pipe(Layer.provide(MembershipRepoLive));

describe("退会と OWNER 委譲の race", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("委譲の commit 前に始めた委譲先の退会は、commit を待って last_owner になり、委譲先が OWNER として残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("transfer-race");
        const from = yield* db.seedUser("transfer-from");
        const to = yield* db.seedUser("transfer-to");
        yield* db.seedMembership(from.id, co, "OWNER");
        yield* db.seedMembership(to.id, co, "ADMIN");

        const written = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const lockRequested = yield* Deferred.make<void>();
        const transfer = transferOwnership({
          actorUserId: from.id,
          toUserId: to.id,
          companyId: co,
        }).pipe(
          Effect.provide(
            auditLogWith((live) => ({
              recordOwnershipTransferred: (...args) =>
                holdBeforeCommit(written, release)(live.recordOwnershipTransferred(...args)),
            })),
          ),
        );
        const deletion = Deferred.await(written).pipe(
          Effect.andThen(
            Effect.exit(
              deleteAccountUnlessLastOwner(to.id).pipe(
                Effect.provide(signalLockRequest(lockRequested)),
              ),
            ),
          ),
        );
        const releaseAfterDeletionStarts = Deferred.await(lockRequested).pipe(
          Effect.andThen(Effect.sleep("50 millis")),
          Effect.andThen(Deferred.succeed(release, undefined)),
        );

        const [, deleted] = yield* Effect.all([transfer, deletion, releaseAfterDeletionStarts], {
          concurrency: "unbounded",
        });

        expectFailure(yield* Effect.flip(deleted), LastOwner, "last_owner", 409);
        expect((yield* db.readMembership(to.id, co))?.role).toBe("OWNER");
      }),
    ));
});

describe("退会と事業所追加の race", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("事業所追加の commit 前に始めた本人の退会は、commit を待って last_owner になり、追加した事業所に OWNER が残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("add-race");

        const written = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const lockRequested = yield* Deferred.make<void>();
        const adding = addCompany(user.id, { name: `${P}add-race-co`, orgCode: "PERSONAL" }).pipe(
          Effect.provide(
            auditLogWith((live) => ({
              recordCompanyCreated: (...args) =>
                holdBeforeCommit(written, release)(live.recordCompanyCreated(...args)),
            })),
          ),
        );
        const deletion = Deferred.await(written).pipe(
          Effect.andThen(
            Effect.exit(
              deleteAccountUnlessLastOwner(user.id).pipe(
                Effect.provide(signalLockRequest(lockRequested)),
              ),
            ),
          ),
        );
        const releaseAfterDeletionStarts = Deferred.await(lockRequested).pipe(
          Effect.andThen(Effect.sleep("50 millis")),
          Effect.andThen(Deferred.succeed(release, undefined)),
        );

        const [added, deleted] = yield* Effect.all([adding, deletion, releaseAfterDeletionStarts], {
          concurrency: "unbounded",
        });

        expectFailure(yield* Effect.flip(deleted), LastOwner, "last_owner", 409);
        expect(yield* ownerIdsOf(added.company.id)).toEqual([user.id]);
      }),
    ));
});

describe("TTL store の session 削除", () => {
  const sentry = recordSentryExceptions();
  beforeEach(cleanup);
  afterAll(cleanup);

  test("commit の後に行い、失敗しても退会は成功して Sentry に記録される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("ttl-after-commit");
        const userRowSeenByTtlDelete = yield* Ref.make<"present" | "absent" | "not-called">(
          "not-called",
        );
        const failingTtlDelete = Layer.effect(
          AuthApi,
          Effect.map(AuthApi, (live) =>
            AuthApi.of({
              ...live,
              deleteUserSessions: (userId) =>
                db.readUser(userId).pipe(
                  Effect.tap((row) => Ref.set(userRowSeenByTtlDelete, row ? "present" : "absent")),
                  Effect.orDie,
                  Effect.andThen(new AuthApiError({ cause: "ttl store down" })),
                ),
            }),
          ),
        );
        sentry.length = 0;

        yield* deleteAccountUnlessLastOwner(user.id).pipe(Effect.provide(failingTtlDelete));

        expect(yield* Ref.get(userRowSeenByTtlDelete)).toBe("absent");
        expect(yield* db.readUser(user.id)).toBeUndefined();
        expect(sentry.map(([error]) => error)).toEqual(["ttl store down"]);
      }),
    ));
});
