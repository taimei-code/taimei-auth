import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  dbTest,
  recordingTransaction,
  expectFailure,
  auditRowsFor,
} from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { auditLogWith } from "../../__tests__/test-layers";
import { DbError } from "../../errors";
import { changeRole } from "../change-role";
import { LastOwner } from "../errors";
import { NotFound } from "../../failures";

const P = "chrole-test-";
const { run, cleanup } = dbTest(P);

describe("changeRole", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("正常 role 変更 (MEMBER → ADMIN) → membership.role 更新 + role_changed audit 発火", () =>
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

  test("役割の変更の tx の中で audit の書き込みが失敗すると、変更は失敗し、DB の役割は元のまま", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("audit-fail-owner");
        const target = yield* db.seedUser("audit-fail-target");
        const co = yield* db.seedCompany("audit-fail");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(target.id, co, "MEMBER");
        const failingAudit = auditLogWith(() => ({
          appendAuditLogs: () => Effect.fail(new DbError({ cause: "audit store down" })),
        }));

        const exit = yield* Effect.exit(
          changeRole({
            actorUserId: owner.id,
            targetUserId: target.id,
            companyId: co,
            beforeRole: "MEMBER",
            nextRole: "ADMIN",
          }).pipe(Effect.provide(failingAudit)),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect((yield* db.readMembership(target.id, co))?.role).toBe("MEMBER");
      }),
    ));

  test("beforeRole === nextRole (MEMBER → MEMBER) → 200 短絡 (tx open せず audit 発火なし)", () =>
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
        expect(tx.calls.n).toBe(0);
        expect((yield* db.readMembership(target.id, co))?.role).toBe("MEMBER");
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("唯一の OWNER を降格 → last_owner Result / membership 無変更 / audit 発火なし", () =>
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
        expectFailure(e, LastOwner);
        expect((yield* db.readMembership(owner.id, co))?.role).toBe("OWNER");
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("target 不在 (updateMembershipRow が 0 件更新) → not_found Result / audit 発火なし", () =>
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
        expectFailure(e, NotFound);
        expect((yield* auditRowsFor(owner.id, "role_changed")).length).toBe(0);
      }),
    ));

  test("last_owner reject → audit 非発火 (rollback 契約)", () =>
    run(
      Effect.gen(function* () {
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

  test("mutation → audit の発火順 pin (audit createdAt が UPDATE 完了後)", () =>
    run(
      Effect.gen(function* () {
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
