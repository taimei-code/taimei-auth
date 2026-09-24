import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auditRowsFor, dbTest, expectFailure } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { LastOwner } from "../errors";
import { NotFound } from "../guard/errors";
import { removeMember } from "../remove";

const P = "rmmem-test-";
const { run, cleanup } = dbTest(P);

const seedUser = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { emailVerified: false });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

const seedCompany = (suffix: string) => TestDb.use((db) => db.seedCompany(suffix));

const join = (userId: string, companyId: string, role: "OWNER" | "ADMIN" | "MEMBER") =>
  TestDb.use((db) => db.seedMembership(userId, companyId, role));

const membershipExists = (userId: string, companyId: string) =>
  TestDb.use((db) => db.readMembership(userId, companyId)).pipe(
    Effect.map((row) => row !== undefined),
  );

const userExists = (id: string) =>
  TestDb.use((db) => db.readUser(id)).pipe(Effect.map((row) => row !== undefined));

const setLastUsed = (userId: string, companyId: string) =>
  TestDb.use((db) => db.setLastUsedCompany(userId, companyId));

const lastUsedOf = (userId: string) =>
  TestDb.use((db) => db.readUser(userId)).pipe(Effect.map((row) => row?.lastUsedCompanyId));

describe("removeMember", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("唯一の所属メンバーを除名 → membership 削除 + account 連動削除", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("only-owner");
        const memberId = yield* seedUser("only-member");
        const companyId = yield* seedCompany("only");
        yield* join(ownerId, companyId, "OWNER");
        yield* join(memberId, companyId, "MEMBER");

        const result = yield* removeMember({
          actorUserId: ownerId,
          targetUserId: memberId,
          companyId,
          targetRole: "MEMBER",
        });

        expect(result).toEqual({ accountDeleted: true });
        expect(yield* membershipExists(memberId, companyId)).toBe(false);
        expect(yield* userExists(memberId)).toBe(false);
      }),
    ));

  test("QA-D-03 他事業所所属のあるメンバーを除名 → membership のみ削除し account 維持", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("multi-owner");
        const memberId = yield* seedUser("multi-member");
        const target = yield* seedCompany("multi-target");
        const other = yield* seedCompany("multi-other");
        yield* join(ownerId, target, "OWNER");
        yield* join(memberId, target, "MEMBER");
        yield* join(memberId, other, "MEMBER");

        const result = yield* removeMember({
          actorUserId: ownerId,
          targetUserId: memberId,
          companyId: target,
          targetRole: "MEMBER",
        });

        expect(result).toEqual({ accountDeleted: false });
        expect(yield* membershipExists(memberId, target)).toBe(false);
        expect(yield* membershipExists(memberId, other)).toBe(true);
        expect(yield* userExists(memberId)).toBe(true);
      }),
    ));

  test("最後の OWNER の除名は last_owner で reject、membership も account も無変更", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("last-owner");
        const companyId = yield* seedCompany("last");
        yield* join(ownerId, companyId, "OWNER");
        yield* setLastUsed(ownerId, companyId);

        const e = yield* Effect.flip(
          removeMember({
            actorUserId: ownerId,
            targetUserId: ownerId,
            companyId,
            targetRole: "OWNER",
          }),
        );

        expectFailure(e, LastOwner, "last_owner", 409);
        expect(yield* membershipExists(ownerId, companyId)).toBe(true);
        expect(yield* userExists(ownerId)).toBe(true);
        expect(yield* lastUsedOf(ownerId)).toBe(companyId);
      }),
    ));

  test("除名した事業所を current に持つ user は、残る所属へ current が移る", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("cur-owner");
        const memberId = yield* seedUser("cur-member");
        const target = yield* seedCompany("cur-target");
        const other = yield* seedCompany("cur-other");
        yield* join(ownerId, target, "OWNER");
        yield* join(memberId, target, "MEMBER");
        yield* join(memberId, other, "MEMBER");
        yield* setLastUsed(memberId, target);

        const result = yield* removeMember({
          actorUserId: ownerId,
          targetUserId: memberId,
          companyId: target,
          targetRole: "MEMBER",
        });

        expect(result).toEqual({ accountDeleted: false });
        expect(yield* lastUsedOf(memberId)).toBe(other);
      }),
    ));

  test("除名した事業所以外を current に持つ user の current は変わらない", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("keep-owner");
        const memberId = yield* seedUser("keep-member");
        const target = yield* seedCompany("keep-target");
        const other = yield* seedCompany("keep-other");
        yield* join(ownerId, target, "OWNER");
        yield* join(memberId, target, "MEMBER");
        yield* join(memberId, other, "MEMBER");
        yield* setLastUsed(memberId, other);

        yield* removeMember({
          actorUserId: ownerId,
          targetUserId: memberId,
          companyId: target,
          targetRole: "MEMBER",
        });

        expect(yield* membershipExists(memberId, target)).toBe(false);
        expect(yield* lastUsedOf(memberId)).toBe(other);
      }),
    ));

  test("同じ事業所に残るメンバーの current は、除名があっても変わらない", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("stay-owner");
        const leaverId = yield* seedUser("stay-leaver");
        const other = yield* seedCompany("stay-other");
        const target = yield* seedCompany("stay-target");
        yield* join(ownerId, other, "OWNER");
        yield* join(ownerId, target, "OWNER");
        yield* join(leaverId, target, "MEMBER");
        yield* join(leaverId, other, "MEMBER");
        yield* setLastUsed(ownerId, target);

        yield* removeMember({
          actorUserId: ownerId,
          targetUserId: leaverId,
          companyId: target,
          targetRole: "MEMBER",
        });

        expect(yield* membershipExists(leaverId, target)).toBe(false);
        expect(yield* lastUsedOf(ownerId)).toBe(target);
      }),
    ));

  test("本人が唯一の所属を退会 (self leave) → account 連動削除", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("self-owner");
        const memberId = yield* seedUser("self-member");
        const companyId = yield* seedCompany("self");
        yield* join(ownerId, companyId, "OWNER");
        yield* join(memberId, companyId, "MEMBER");

        const result = yield* removeMember({
          actorUserId: memberId,
          targetUserId: memberId,
          companyId,
          targetRole: "MEMBER",
        });

        expect(result).toEqual({ accountDeleted: true });
        expect(yield* userExists(memberId)).toBe(false);
      }),
    ));

  test("同じ member を 2 回除名 → 2 回目は not_found で、membership_removed audit は 1 回目の 1 行だけ", () =>
    run(
      Effect.gen(function* () {
        const ownerId = yield* seedUser("twice-owner");
        const memberId = yield* seedUser("twice-member");
        const companyId = yield* seedCompany("twice");
        yield* join(ownerId, companyId, "OWNER");
        yield* join(memberId, companyId, "MEMBER");
        const remove = () =>
          removeMember({
            actorUserId: ownerId,
            targetUserId: memberId,
            companyId,
            targetRole: "MEMBER",
          });

        expect(yield* remove()).toEqual({ accountDeleted: true });
        const e = yield* Effect.flip(remove());

        expectFailure(e, NotFound, "not_found", 404);
        expect((yield* auditRowsFor(ownerId, "membership_removed")).length).toBe(1);
      }),
    ));
});
