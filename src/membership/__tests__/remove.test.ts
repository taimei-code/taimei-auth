import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest, expectFailure } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { LastOwner } from "../errors";
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

// アカウント存否は実テーブルを直接見て判定する (被験体の repository に依らず actual state を検証する)。
const userExists = (id: string) =>
  TestDb.use((db) => db.readUser(id)).pipe(Effect.map((row) => row !== undefined));

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
});
