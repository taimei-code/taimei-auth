import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { Forbidden } from "../../membership/guard/errors";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { deleteCompany } from "../delete";
import { NotFoundOrAlreadyDeleted } from "../errors";

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
        expect(yield* auditCount(ownerId, "company_deleted")).toBe(1);
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
        yield* join(ownerId, other); // 招待者 (owner) が orphan 削除されず生存し REVOKED を観測できるようにする
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

  test("非 OWNER (MEMBER) は forbidden、無変更", () =>
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

  test("存在しない companyId は not_found_or_already_deleted", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("nf");
        const e = yield* Effect.flip(deleteCompany(ownerId, "cmp_does_not_exist"));
        expectFailure(e, NotFoundOrAlreadyDeleted, "not_found_or_already_deleted", 404);
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
        yield* join(ownerId, other); // owner を生存させ audit を観測する

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
