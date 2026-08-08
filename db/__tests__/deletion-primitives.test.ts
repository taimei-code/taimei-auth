import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId, insertCompany, softDeleteCompany } from "../repositories/company";
import {
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  revokePendingInvitationsOfCompany,
} from "../repositories/invitation";
import {
  countActiveMembershipsByUserId,
  generateMembershipId,
  insertMembership,
  removeMembershipsOfCompany,
  type Role,
} from "../repositories/membership";
import { findUserById, reassignLastUsedCompanyForDeletedCompany } from "../repositories/user";
import { company, invitation, membership, user } from "../schema";

const P = "delprim-test-";

// FK: invitation.invited_by_user_id / company_id は cascade、membership.company_id は restrict。
// 物理 company 削除 (cleanup) のため membership → company の順、invitation は先に消す。
async function cleanup() {
  await db.delete(invitation).where(like(invitation.email, `${P}%`));
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
}

async function seedUser(suffix: string, lastUsedCompanyId?: string): Promise<string> {
  const id = `${P}u-${suffix}`;
  await db.insert(user).values({
    id,
    name: `U ${suffix}`,
    email: `${P}${suffix}@example.com`,
    emailVerified: false,
    lastUsedCompanyId: lastUsedCompanyId ?? null,
  });
  return id;
}

async function seedCompany(suffix: string): Promise<string> {
  const id = generateCompanyId();
  await insertCompany({ id, name: `${P}co-${suffix}`, orgCode: "PERSONAL" });
  return id;
}

async function join(userId: string, companyId: string, role: Role = "OWNER") {
  await insertMembership({ id: generateMembershipId(), userId, companyId, role });
}

describe("countActiveMembershipsByUserId", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("ACTIVE company の membership のみ数え、DELETED company の残存 membership は数えない", async () => {
    const userId = await seedUser("count");
    const active = await seedCompany("count-active");
    const deleted = await seedCompany("count-deleted");
    await join(userId, active);
    await join(userId, deleted);
    await softDeleteCompany(deleted);

    expect(await countActiveMembershipsByUserId(userId)).toBe(1);
  });

  test("所属なしは 0", async () => {
    const userId = await seedUser("count-zero");
    expect(await countActiveMembershipsByUserId(userId)).toBe(0);
  });
});

describe("removeMembershipsOfCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("対象 company の membership を全て物理削除し削除行を返す。他 company は無傷", async () => {
    const target = await seedCompany("rm-target");
    const other = await seedCompany("rm-other");
    const u1 = await seedUser("rm-1");
    const u2 = await seedUser("rm-2");
    await join(u1, target);
    await join(u2, target);
    await join(u1, other);

    const removed = await removeMembershipsOfCompany(target);
    expect(removed.length).toBe(2);
    expect(removed.map((r) => r.userId).sort()).toEqual([u1, u2].sort());

    const left = await db.select().from(membership).where(eq(membership.companyId, target));
    expect(left.length).toBe(0);
    const otherLeft = await db.select().from(membership).where(eq(membership.companyId, other));
    expect(otherLeft.length).toBe(1);
  });

  test("membership 0 件の company は no-op で空配列を返す", async () => {
    const empty = await seedCompany("rm-empty");
    expect((await removeMembershipsOfCompany(empty)).length).toBe(0);
  });
});

describe("reassignLastUsedCompanyForDeletedCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("削除 company を last_used に持つ user は残存 active membership へ付け替え", async () => {
    const deleted = await seedCompany("re-deleted");
    const surviving = await seedCompany("re-surviving");
    const userId = await seedUser("re-1", deleted);
    await join(userId, surviving);
    // 削除フローでは先に対象 company の membership が消える
    await removeMembershipsOfCompany(deleted);

    await reassignLastUsedCompanyForDeletedCompany(deleted);

    expect((await findUserById(userId))?.lastUsedCompanyId).toBe(surviving);
  });

  test("残存 active membership が無ければ NULL", async () => {
    const deleted = await seedCompany("re-null");
    const userId = await seedUser("re-2", deleted);
    await join(userId, deleted);
    await removeMembershipsOfCompany(deleted);

    await reassignLastUsedCompanyForDeletedCompany(deleted);

    expect((await findUserById(userId))?.lastUsedCompanyId).toBeNull();
  });

  test("削除 company 以外を last_used に持つ user は不変", async () => {
    const deleted = await seedCompany("re-untouched-del");
    const other = await seedCompany("re-untouched-other");
    const userId = await seedUser("re-3", other);
    await join(userId, other);

    await reassignLastUsedCompanyForDeletedCompany(deleted);

    expect((await findUserById(userId))?.lastUsedCompanyId).toBe(other);
  });
});

describe("revokePendingInvitationsOfCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("PENDING のみ REVOKED 化し revoked 行を返す。ACCEPTED は不変", async () => {
    const companyId = await seedCompany("inv-co");
    const inviter = await seedUser("inv-by");
    const mk = (s: string) =>
      insertInvitation({
        id: generateInvitationId(),
        companyId,
        email: `${P}invite-${s}@example.com`,
        role: "MEMBER",
        token: generateInvitationToken(),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedByUserId: inviter,
      });
    const p1 = await mk("p1");
    const p2 = await mk("p2");
    const accepted = await mk("acc");
    await db
      .update(invitation)
      .set({ status: "ACCEPTED", acceptedAt: new Date() })
      .where(eq(invitation.id, accepted.id));

    const revoked = await revokePendingInvitationsOfCompany(companyId);
    expect(revoked.map((r) => r.id).sort()).toEqual([p1.id, p2.id].sort());

    const rows = await db.select().from(invitation).where(eq(invitation.companyId, companyId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(p1.id)?.status).toBe("REVOKED");
    expect(byId.get(p1.id)?.revokedAt).not.toBeNull();
    expect(byId.get(p2.id)?.status).toBe("REVOKED");
    expect(byId.get(accepted.id)?.status).toBe("ACCEPTED");
  });

  test("PENDING 0 件は空配列", async () => {
    const companyId = await seedCompany("inv-empty");
    expect((await revokePendingInvitationsOfCompany(companyId)).length).toBe(0);
  });
});
