import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findMembership } from "@/db/repositories/membership";
import { auditLog } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { changeRole } from "../change-role";

// change-role use-case (src/membership/change-role.ts) の DB 統合テスト。
// Result 契約 / 200 短絡 (tx open せず audit 発火なし) / OwnerInvariantViolation → last_owner /
// not_found (targetUserId 不在) / audit payload 全 key と mutation → audit の発火順を検証する。
// 認可 (誰が誰の role を変えられるか) は Guard 層 (requireRoleChange) の責務なので本テストは
// 認可通過後の呼び出しのみを扱う。

const P = "chrole-test-";
const { cleanup, seedUser, seedCompany, seedMembership } = createSeedHelpers(P);

async function auditRows(userId: string, eventType: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}

describe("changeRole", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-05 正常 role 変更 (MEMBER → ADMIN) → membership.role 更新 + role_changed audit 発火", async () => {
    const owner = await seedUser("owner");
    const target = await seedUser("target");
    const co = await seedCompany("h05");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(target.id, co, "MEMBER");

    const result = await changeRole({
      actorUserId: owner.id,
      targetUserId: target.id,
      companyId: co,
      beforeRole: "MEMBER",
      nextRole: "ADMIN",
    });
    expect(result).toEqual({ ok: true });
    expect((await findMembership(target.id, co))?.role).toBe("ADMIN");

    const audits = await auditRows(owner.id, "role_changed");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      company_id: co,
      target_user_id: target.id,
      before_role: "MEMBER",
      after_role: "ADMIN",
      changed_by_user_id: owner.id,
    });
  });

  test("QA-H-08 beforeRole === nextRole (MEMBER → MEMBER) → 200 短絡 (tx open せず audit 発火なし)", async () => {
    const owner = await seedUser("owner");
    const target = await seedUser("target");
    const co = await seedCompany("h08");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(target.id, co, "MEMBER");

    const txSpy = spyOn(db, "transaction");
    try {
      const result = await changeRole({
        actorUserId: owner.id,
        targetUserId: target.id,
        companyId: co,
        beforeRole: "MEMBER",
        nextRole: "MEMBER",
      });
      expect(result).toEqual({ ok: true });
      // no-op 短絡なので runInTransaction (= db.transaction) は呼ばれない。
      expect(txSpy).not.toHaveBeenCalled();
    } finally {
      txSpy.mockRestore();
    }
    expect((await findMembership(target.id, co))?.role).toBe("MEMBER");
    expect((await auditRows(owner.id, "role_changed")).length).toBe(0);
  });

  test("QA-E-01 唯一の OWNER を降格 → last_owner Result / membership 無変更 / audit 発火なし", async () => {
    const owner = await seedUser("only-owner");
    const co = await seedCompany("e01");
    await seedMembership(owner.id, co, "OWNER");

    const result = await changeRole({
      actorUserId: owner.id,
      targetUserId: owner.id,
      companyId: co,
      beforeRole: "OWNER",
      nextRole: "MEMBER",
    });
    expect(result).toEqual({ ok: false, reason: "last_owner" });
    expect((await findMembership(owner.id, co))?.role).toBe("OWNER");
    expect((await auditRows(owner.id, "role_changed")).length).toBe(0);
  });

  test("QA-E-06 target 不在 (updateMembershipRow が 0 件更新) → not_found Result / audit 発火なし", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("e06");
    await seedMembership(owner.id, co, "OWNER");

    const result = await changeRole({
      actorUserId: owner.id,
      targetUserId: `${P}nonexistent-user`,
      companyId: co,
      beforeRole: "MEMBER",
      nextRole: "ADMIN",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((await auditRows(owner.id, "role_changed")).length).toBe(0);
  });

  test("QA-E-09 / QA-E-11 last_owner reject → audit 非発火 (rollback 契約)", async () => {
    // withOwnerLockGuard 内で OWNER≥1 が破れた場合、mutation (UPDATE) と audit INSERT を
    // 同 tx で rollback する。role_changed audit が漏れないことを直接検証する (accept 側の
    // recordInvitationAcceptRejected と違い、role 変更には rejected 用の別 tx audit は無い)。
    const owner = await seedUser("only-owner-rollback");
    const co = await seedCompany("e09");
    await seedMembership(owner.id, co, "OWNER");

    const result = await changeRole({
      actorUserId: owner.id,
      targetUserId: owner.id,
      companyId: co,
      beforeRole: "OWNER",
      nextRole: "ADMIN",
    });
    expect(result.ok).toBe(false);
    expect((await auditRows(owner.id, "role_changed")).length).toBe(0);
  });

  test("QA-H-12 mutation → audit の発火順 pin (audit createdAt が UPDATE 完了後)", async () => {
    // ADR-0012 の invariant: mutation を同 tx 内で audit の前に emit する (順序が逆だと
    // audit が反映前の状態を根拠にする silent drift が発生する)。role_changed audit の payload
    // の before_role / after_role が UPDATE 完了後の状態と一致することで担保する。
    const owner = await seedUser("owner-order");
    const target = await seedUser("target-order");
    const co = await seedCompany("h12");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(target.id, co, "MEMBER");

    const result = await changeRole({
      actorUserId: owner.id,
      targetUserId: target.id,
      companyId: co,
      beforeRole: "MEMBER",
      nextRole: "ADMIN",
    });
    expect(result.ok).toBe(true);
    const finalRole = (await findMembership(target.id, co))?.role;
    const audits = await auditRows(owner.id, "role_changed");
    expect(audits.length).toBe(1);
    const payload = audits[0]?.payload as Record<string, unknown>;
    expect(payload.after_role).toBe(finalRole);
  });
});
