import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { findCompanyById, generateCompanyId, insertCompany } from "@/db/repositories/company";
import {
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
} from "@/db/repositories/invitation";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { auditLog, company, invitation, membership, session, user } from "@/db/schema";
import { deleteCompany } from "../delete";

const P = "delco-test-";

async function cleanup() {
  await db.delete(auditLog).where(like(auditLog.userId, `${P}%`));
  await db.delete(invitation).where(like(invitation.email, `${P}%`));
  await db.delete(session).where(like(session.userId, `${P}%`));
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
  await db.insert(session).values({
    id: `${P}s-${suffix}`,
    token: `${P}tok-${suffix}`,
    userId: id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return id;
}

async function seedCompany(suffix: string): Promise<string> {
  const id = generateCompanyId();
  await insertCompany({ id, name: `${P}co-${suffix}`, orgCode: "PERSONAL" });
  return id;
}

async function join(
  userId: string,
  companyId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER",
) {
  await insertMembership({ id: generateMembershipId(), userId, companyId, role });
}

async function membershipCount(companyId: string): Promise<number> {
  return (await db.select().from(membership).where(eq(membership.companyId, companyId))).length;
}

async function auditCount(userId: string, eventType: string): Promise<number> {
  return (
    await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
  ).length;
}

describe("deleteCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("唯一の事業所を sole OWNER が削除 → company DELETED / membership 0 / actor も削除", async () => {
    const ownerId = await seedUser("sole");
    const companyId = await seedCompany("sole");
    await join(ownerId, companyId);

    const result = await deleteCompany(ownerId, companyId);

    expect(result).toEqual({ ok: true, actorDeleted: true });
    expect((await findCompanyById(companyId))?.activationStatus).toBe("DELETED");
    expect(await membershipCount(companyId)).toBe(0);
    expect(await findUserById(ownerId)).toBeUndefined();
    expect(await auditCount(ownerId, "company_deleted")).toBe(1);
    expect(await auditCount(ownerId, "membership_removed")).toBe(1);
    expect(await auditCount(ownerId, "account_delete")).toBe(1);
    const sessions = await db.select().from(session).where(eq(session.userId, ownerId));
    expect(sessions.length).toBe(0);
  });

  test("複数所属の OWNER が 1 事業所を削除 → actor は残り他事業所所属も無傷", async () => {
    const ownerId = await seedUser("multi");
    const target = await seedCompany("multi-target");
    const other = await seedCompany("multi-other");
    await join(ownerId, target);
    await join(ownerId, other);

    const result = await deleteCompany(ownerId, target);

    expect(result).toEqual({ ok: true, actorDeleted: false });
    expect(await findUserById(ownerId)).toBeDefined();
    expect(await membershipCount(target)).toBe(0);
    expect(await membershipCount(other)).toBe(1);
  });

  test("他に所属の無いメンバーは連動削除、他事業所所属メンバーは残る", async () => {
    const ownerId = await seedUser("mix-owner");
    const orphanMember = await seedUser("mix-orphan");
    const survivor = await seedUser("mix-survivor");
    const target = await seedCompany("mix-target");
    const other = await seedCompany("mix-other");
    await join(ownerId, target);
    await join(orphanMember, target, "MEMBER");
    await join(survivor, target, "MEMBER");
    await join(survivor, other, "OWNER");

    await deleteCompany(ownerId, target);

    expect(await findUserById(orphanMember)).toBeUndefined();
    expect(await findUserById(survivor)).toBeDefined();
    expect(await membershipCount(other)).toBe(1);
  });

  test("削除 company を last_used に持つ生存メンバーは残存所属へ付け替え", async () => {
    const ownerId = await seedUser("re-owner");
    const target = await seedCompany("re-target");
    const other = await seedCompany("re-other");
    await join(ownerId, target);
    const survivor = await seedUser("re-survivor", target);
    await join(survivor, target, "MEMBER");
    await join(survivor, other, "MEMBER");

    await deleteCompany(ownerId, target);

    expect((await findUserById(survivor))?.lastUsedCompanyId).toBe(other);
  });

  test("PENDING invitation は REVOKED 化される", async () => {
    const ownerId = await seedUser("inv-owner");
    const target = await seedCompany("inv-target");
    const other = await seedCompany("inv-other");
    await join(ownerId, target);
    await join(ownerId, other); // 招待者 (owner) が orphan 削除されず生存し REVOKED を観測できるようにする
    const inv = await insertInvitation({
      id: generateInvitationId(),
      companyId: target,
      email: `${P}invitee@example.com`,
      role: "MEMBER",
      token: generateInvitationToken(),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: ownerId,
    });

    await deleteCompany(ownerId, target);

    const row = await db
      .select()
      .from(invitation)
      .where(eq(invitation.id, inv.id))
      .then((r) => r.at(0));
    expect(row?.status).toBe("REVOKED");
  });

  test("非 OWNER (MEMBER) は forbidden、無変更", async () => {
    const ownerId = await seedUser("fb-owner");
    const memberId = await seedUser("fb-member");
    const companyId = await seedCompany("fb");
    await join(ownerId, companyId);
    await join(memberId, companyId, "MEMBER");

    const result = await deleteCompany(memberId, companyId);

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect((await findCompanyById(companyId))?.activationStatus).toBe("ACTIVE");
    expect(await membershipCount(companyId)).toBe(2);
  });

  test("存在しない companyId は not_found_or_already_deleted", async () => {
    const ownerId = await seedUser("nf");
    const result = await deleteCompany(ownerId, "cmp_does_not_exist");
    expect(result).toEqual({ ok: false, reason: "not_found_or_already_deleted" });
  });

  test("既に削除済みの事業所への再削除は冪等 (ok / actorDeleted false)", async () => {
    const ownerId = await seedUser("idem-owner");
    const target = await seedCompany("idem-target");
    const other = await seedCompany("idem-other");
    await join(ownerId, target);
    await join(ownerId, other);

    await deleteCompany(ownerId, target);
    const second = await deleteCompany(ownerId, target);

    expect(second).toEqual({ ok: true, actorDeleted: false });
  });

  test("並行 DeleteCompany でも company_deleted audit は 1 件のみ (二重処理しない)", async () => {
    const ownerId = await seedUser("race-owner");
    const target = await seedCompany("race-target");
    const other = await seedCompany("race-other");
    await join(ownerId, target);
    await join(ownerId, other); // owner を生存させ audit を観測する

    const results = await Promise.all([
      deleteCompany(ownerId, target),
      deleteCompany(ownerId, target),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await auditCount(ownerId, "company_deleted")).toBe(1);
    expect(await membershipCount(target)).toBe(0);
  });
});
