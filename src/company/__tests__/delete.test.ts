import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Ref } from "effect";
import { Forbidden } from "../../membership/guard/errors";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { TestDb } from "../../__tests__/test-db";
import { auditLogWith, authApiWith, failingSessionDeletion } from "../../__tests__/test-layers";
import { storedSessionsOf } from "../../__tests__/test-ttl-store";
import { DbError } from "../../errors";
import { createSessionFor } from "../../mfa/__tests__/helpers";
import { deleteCompany } from "../delete";

const P = "delco-test-";
const { run, cleanup } = dbTest(P);

const seedUser = (suffix: string, lastUsedCompanyId?: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, {
      emailVerified: false,
      lastUsedCompanyId: lastUsedCompanyId ?? null,
    });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

const seedCompany = (suffix: string) => TestDb.use((db) => db.seedCompany(suffix));

const join = (userId: string, companyId: string, role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") =>
  TestDb.use((db) => db.seedMembership(userId, companyId, role));

const membershipCount = (companyId: string) => TestDb.use((db) => db.countMemberships(companyId));

const auditCount = (userId: string, eventType: string) =>
  auditRowsFor(userId, eventType).pipe(Effect.map((rows) => rows.length));

describe("deleteCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("唯一の事業所を sole OWNER が削除 → company DELETED / membership 0 / actor も削除", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("sole");
        const companyId = yield* seedCompany("sole");
        yield* join(ownerId, companyId);

        const result = yield* deleteCompany(ownerId, companyId);

        expect(result).toEqual({ actorDeleted: true });
        expect((yield* db.readCompany(companyId))?.activationStatus).toBe("DELETED");
        expect(yield* membershipCount(companyId)).toBe(0);
        expect(yield* db.readUser(ownerId)).toBeUndefined();
        const deletedAudits = yield* auditRowsFor(ownerId, "company_deleted");
        expect(deletedAudits.map((r) => r.payload)).toEqual([
          {
            deleted_by_user_id: ownerId,
            company_id: companyId,
            name_at_deletion: db.ids.companyName("sole"),
          },
        ]);
        expect(yield* auditCount(ownerId, "membership_removed")).toBe(1);
        expect(yield* auditCount(ownerId, "account_delete")).toBe(1);
        expect((yield* db.readSessions(ownerId)).length).toBe(0);
      }),
    ));

  test("複数所属の OWNER が 1 事業所を削除 → actor は残り他事業所所属も無傷", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("multi");
        const target = yield* seedCompany("multi-target");
        const other = yield* seedCompany("multi-other");
        yield* join(ownerId, target);
        yield* join(ownerId, other);

        const result = yield* deleteCompany(ownerId, target);

        expect(result).toEqual({ actorDeleted: false });
        expect(yield* db.readUser(ownerId)).toBeDefined();
        expect(yield* membershipCount(target)).toBe(0);
        expect(yield* membershipCount(other)).toBe(1);
      }),
    ));

  test("他に所属の無いメンバーは連動削除、他事業所所属メンバーは残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("mix-owner");
        const orphanMember = yield* seedUser("mix-orphan");
        const survivor = yield* seedUser("mix-survivor");
        const target = yield* seedCompany("mix-target");
        const other = yield* seedCompany("mix-other");
        yield* join(ownerId, target);
        yield* join(orphanMember, target, "MEMBER");
        yield* join(survivor, target, "MEMBER");
        yield* join(survivor, other, "OWNER");

        yield* deleteCompany(ownerId, target);

        expect(yield* db.readUser(orphanMember)).toBeUndefined();
        expect(yield* db.readUser(survivor)).toBeDefined();
        expect(yield* membershipCount(other)).toBe(1);
      }),
    ));

  test("削除 company を last_used に持つ生存メンバーは残存所属へ付け替え", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("re-owner");
        const target = yield* seedCompany("re-target");
        const other = yield* seedCompany("re-other");
        yield* join(ownerId, target);
        const survivor = yield* seedUser("re-survivor", target);
        yield* join(survivor, target, "MEMBER");
        yield* join(survivor, other, "MEMBER");

        yield* deleteCompany(ownerId, target);

        expect((yield* db.readUser(survivor))?.lastUsedCompanyId).toBe(other);
      }),
    ));

  test("PENDING invitation は REVOKED 化される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("inv-owner");
        const target = yield* seedCompany("inv-target");
        const other = yield* seedCompany("inv-other");
        yield* join(ownerId, target);
        yield* join(ownerId, other); // 招待者 (owner) が orphan として削除されずに残り、REVOKED を観測できるようにする
        const inv = yield* db.seedInvitation({
          companyId: target,
          email: db.ids.email("invitee"),
          role: "MEMBER",
          invitedByUserId: ownerId,
        });

        yield* deleteCompany(ownerId, target);

        expect((yield* db.readInvitation(inv.id))?.status).toBe("REVOKED");
      }),
    ));

  test("guard 通過後に降格された actor (MEMBER) は lock 後の再確認で forbidden、無変更", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("fb-owner");
        const memberId = yield* seedUser("fb-member");
        const companyId = yield* seedCompany("fb");
        yield* join(ownerId, companyId);
        yield* join(memberId, companyId, "MEMBER");

        const e = yield* Effect.flip(deleteCompany(memberId, companyId));

        expectFailure(e, Forbidden, "forbidden", 403);
        expect((yield* db.readCompany(companyId))?.activationStatus).toBe("ACTIVE");
        expect(yield* membershipCount(companyId)).toBe(2);
      }),
    ));

  test("存在しない companyId は非メンバーと同じ forbidden (存在を観測させない)", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("nf");
        const e = yield* Effect.flip(deleteCompany(ownerId, "cmp_does_not_exist"));
        expectFailure(e, Forbidden, "forbidden", 403);
      }),
    ));

  test("既に削除済みの事業所への再削除は冪等 (ok / actorDeleted false)", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("idem-owner");
        const target = yield* seedCompany("idem-target");
        const other = yield* seedCompany("idem-other");
        yield* join(ownerId, target);
        yield* join(ownerId, other);

        yield* deleteCompany(ownerId, target);
        const second = yield* deleteCompany(ownerId, target);

        expect(second).toEqual({ actorDeleted: false });
      }),
    ));

  test("並行 DeleteCompany でも company_deleted audit は 1 件のみ (二重処理しない)", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("race-owner");
        const target = yield* seedCompany("race-target");
        const other = yield* seedCompany("race-other");
        yield* join(ownerId, target);
        yield* join(ownerId, other); // owner を残して audit を観測する

        const results = yield* Effect.all(
          [
            Effect.exit(deleteCompany(ownerId, target)),
            Effect.exit(deleteCompany(ownerId, target)),
          ],
          { concurrency: "unbounded" },
        );

        expect(results.every(Exit.isSuccess)).toBe(true);
        expect(yield* auditCount(ownerId, "company_deleted")).toBe(1);
        expect(yield* membershipCount(target)).toBe(0);
      }),
    ));
});

describe("deleteCompany の TTL store の session 削除", () => {
  const sentry = recordSentryExceptions();
  beforeEach(cleanup);
  afterAll(cleanup);

  const seedTwoOrphans = (suffix: string) =>
    Effect.gen(function* () {
      const ownerId = yield* seedUser(`${suffix}-owner`);
      const memberId = yield* seedUser(`${suffix}-member`);
      const companyId = yield* seedCompany(suffix);
      yield* join(ownerId, companyId, "OWNER");
      yield* join(memberId, companyId, "MEMBER");
      const sessions = [
        { userId: ownerId, token: (yield* createSessionFor(ownerId)).token },
        { userId: memberId, token: (yield* createSessionFor(memberId)).token },
      ];
      return { ownerId, memberId, companyId, sessions };
    });

  test("他に所属の無い 2 人は commit 後にどちらも session と索引が消える", () =>
    run(
      Effect.gen(function* () {
        const { ownerId, companyId, sessions } = yield* seedTwoOrphans("ttl-both");

        expect(yield* deleteCompany(ownerId, companyId)).toEqual({ actorDeleted: true });

        expect(yield* storedSessionsOf(sessions)).toEqual([
          { session: false, index: false },
          { session: false, index: false },
        ]);
      }),
    ));

  test("TTL store が失敗しても削除は成功し、user 行が消えた後に呼ばれ、Sentry に 2 件記録される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const { ownerId, memberId, companyId } = yield* seedTwoOrphans("ttl-failing");
        const failing = yield* failingSessionDeletion;
        sentry.length = 0;

        yield* deleteCompany(ownerId, companyId).pipe(Effect.provide(failing.layer));

        expect((yield* db.readCompany(companyId))?.activationStatus).toBe("DELETED");
        expect(yield* db.readUser(ownerId)).toBeUndefined();
        expect(yield* db.readUser(memberId)).toBeUndefined();
        expect(yield* Ref.get(failing.userRowPresentAtCall)).toEqual([false, false]);
        expect(sentry.map(([error, context]) => [error, context?.tags, context?.extra])).toEqual(
          [ownerId, memberId]
            .sort()
            .map((userId) => [
              "ttl store down",
              { component: "deleteAccount", flow: "company-delete" },
              { userId },
            ]),
        );
      }),
    ));

  test("orphan の削除の後で tx が失敗すると、user と session と索引が残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const { ownerId, memberId, companyId, sessions } = yield* seedTwoOrphans("ttl-rollback");
        const failingAudit = auditLogWith(() => ({
          recordCompanyDeleted: () => new DbError({ cause: "audit down" }),
        }));

        const exit = yield* Effect.exit(
          deleteCompany(ownerId, companyId).pipe(Effect.provide(failingAudit)),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* db.readUser(ownerId)).toBeDefined();
        expect(yield* db.readUser(memberId)).toBeDefined();
        expect(yield* storedSessionsOf(sessions)).toEqual([
          { session: true, index: true },
          { session: true, index: true },
        ]);
      }),
    ));

  test("DELETED の事業所の再削除では TTL store を呼ばない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const ownerId = yield* seedUser("ttl-deleted-owner");
        const companyId = yield* seedCompany("ttl-deleted");
        yield* join(ownerId, companyId, "OWNER");
        yield* db.markCompanyDeleted(companyId);
        const calls = yield* Ref.make(0);
        const counting = authApiWith((live) => ({
          deleteUserSessions: (userId) =>
            Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(live.deleteUserSessions(userId))),
        }));

        expect(yield* deleteCompany(ownerId, companyId).pipe(Effect.provide(counting))).toEqual({
          actorDeleted: false,
        });
        expect(yield* Ref.get(calls)).toBe(0);
      }),
    ));
});

describe("共通の member を持つ事業所の同時削除 (不安定な失敗を検知するため 5 回繰り返す)", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  for (let i = 1; i <= 5; i++) {
    test(`iteration ${i}: 両方の削除が成功し、他に所属の無い共通の member 2 人はどちらも消える`, () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const shared = [yield* seedUser(`shared-${i}-a`), yield* seedUser(`shared-${i}-b`)];
          const deletions = [];
          for (const side of ["x", "y"]) {
            const ownerId = yield* seedUser(`shared-${i}-${side}-owner`);
            const companyId = yield* seedCompany(`shared-${i}-${side}`);
            yield* join(ownerId, companyId, "OWNER");
            yield* db.seedMembership(
              ownerId,
              yield* seedCompany(`shared-${i}-${side}-keep`),
              "OWNER",
            );
            for (const userId of shared) yield* join(userId, companyId, "MEMBER");
            deletions.push(deleteCompany(ownerId, companyId));
          }

          yield* Effect.all(deletions, { concurrency: "unbounded" });

          for (const userId of shared) expect(yield* db.readUser(userId)).toBeUndefined();
        }),
      ));
  }
});
