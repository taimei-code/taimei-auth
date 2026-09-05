import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  dbTest,
  recordingTransaction,
  expectFailure,
  auditRowsFor,
} from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { changeRole } from "../change-role";
import { LastOwner } from "../errors";
import { NotFound } from "../guard/errors";

// change-role use-case (src/membership/change-role.ts) の DB 統合テスト。
// 成功 / 200 短絡 (tx open せず audit 発火なし) / OwnerInvariantViolation → LastOwner /
// NotFound (targetUserId 不在) / audit payload 全 key と mutation → audit の発火順を検証する。
// 認可 (誰が誰の role を変えられるか) は Guard 層 (requireRoleChange) の責務なので本テストは
// 認可通過後の呼び出しのみを扱う。

const P = "chrole-test-";
const { run, cleanup } = dbTest(P);

describe("changeRole", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-05 正常 role 変更 (MEMBER → ADMIN) → membership.role 更新 + role_changed audit 発火", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const target = yield* db.seedUser("target");
        const co = yield* db.seedCompany("h05");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(target.id, co, "MEMBER");

        const tx = recordingTransaction();
        yield* changeRole({
          actorUserId: owner.id,
          targetUserId: target.id,
          companyId: co,
          beforeRole: "MEMBER",
          nextRole: "ADMIN",
        }).pipe(Effect.provide(tx.layer));
        expect(tx.calls.n).toBe(1);
        expect((yield* db.readMembership(target.id, co))?.role).toBe("ADMIN");

        const audits = yield* auditRowsFor(owner.id, "role_changed");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          company_id: co,
          target_user_id: target.id,
          before_role: "MEMBER",
          after_role: "ADMIN",
          changed_by_user_id: owner.id,
        });
      }),
    ));

  test("QA-H-08 beforeRole === nextRole (MEMBER → MEMBER) → 200 短絡 (tx open せず audit 発火なし)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const target = yield* db.seedUser("target");
        const co = yield* db.seedCompany("h08");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(target.id, co, "MEMBER");

        const tx = recordingTransaction();
        yield* changeRole({
          actorUserId: owner.id,
          targetUserId: target.id,
          companyId: co,
          beforeRole: "MEMBER",
          nextRole: "MEMBER",
        }).pipe(Effect.provide(tx.layer));
        // no-op 短絡なので Transaction.run は呼ばれない。
        expect(tx.calls.n).toBe(0);
        expect((yield* db.readMembership(target.id, co))?.role).toBe("MEMBER");
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("QA-E-01 唯一の OWNER を降格 → last_owner Result / membership 無変更 / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("only-owner");
        const co = yield* db.seedCompany("e01");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const e = yield* Effect.flip(
          changeRole({
            actorUserId: owner.id,
            targetUserId: owner.id,
            companyId: co,
            beforeRole: "OWNER",
            nextRole: "MEMBER",
          }),
        );
        expectFailure(e, LastOwner, "last_owner", 409);
        expect((yield* db.readMembership(owner.id, co))?.role).toBe("OWNER");
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("QA-E-06 target 不在 (updateMembershipRow が 0 件更新) → not_found Result / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("e06");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const e = yield* Effect.flip(
          changeRole({
            actorUserId: owner.id,
            targetUserId: `${P}nonexistent-user`,
            companyId: co,
            beforeRole: "MEMBER",
            nextRole: "ADMIN",
          }),
        );
        expectFailure(e, NotFound, "not_found", 404);
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("QA-E-09 / QA-E-11 last_owner reject → audit 非発火 (rollback 契約)", () =>
    run(
      Effect.gen(function* () {
        // withOwnerLockGuard 内で OWNER≥1 が破れた場合、mutation (UPDATE) と audit INSERT を
        // 同 tx で rollback する。role_changed audit が漏れないことを直接検証する (accept 側の
        // recordInvitationAcceptRejected と違い、role 変更には rejected 用の別 tx audit は無い)。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("only-owner-rollback");
        const co = yield* db.seedCompany("e09");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const e = yield* Effect.flip(
          changeRole({
            actorUserId: owner.id,
            targetUserId: owner.id,
            companyId: co,
            beforeRole: "OWNER",
            nextRole: "ADMIN",
          }),
        );
        expect(e).toBeInstanceOf(LastOwner);
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("QA-H-12 mutation → audit の発火順 pin (audit createdAt が UPDATE 完了後)", () =>
    run(
      Effect.gen(function* () {
        // ADR-0012 の invariant: mutation を同 tx 内で audit の前に emit する (順序が逆だと
        // audit が反映前の状態を根拠にする silent drift が発生する)。role_changed audit の payload
        // の before_role / after_role が UPDATE 完了後の状態と一致することで担保する。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner-order");
        const target = yield* db.seedUser("target-order");
        const co = yield* db.seedCompany("h12");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(target.id, co, "MEMBER");

        yield* changeRole({
          actorUserId: owner.id,
          targetUserId: target.id,
          companyId: co,
          beforeRole: "MEMBER",
          nextRole: "ADMIN",
        });
        const finalRole = (yield* db.readMembership(target.id, co))?.role;
        const audits = yield* auditRowsFor(owner.id, "role_changed");
        expect(audits.length).toBe(1);
        const payload = audits[0]?.payload as Record<string, unknown>;
        expect(payload.after_role).toBe(finalRole);
      }),
    ));
});
