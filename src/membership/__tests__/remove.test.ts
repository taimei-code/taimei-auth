import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany } from "@/db/repositories/company";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { company, membership, session, user } from "@/db/schema";
import { removeMember } from "../remove";

const P = "rmmem-test-";

async function cleanup() {
  await db.delete(session).where(like(session.userId, `${P}%`));
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
}

async function seedUser(suffix: string): Promise<string> {
  const id = `${P}u-${suffix}`;
  await db
    .insert(user)
    .values({ id, name: `U ${suffix}`, email: `${P}${suffix}@example.com`, emailVerified: false });
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

async function join(userId: string, companyId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  await insertMembership({ id: generateMembershipId(), userId, companyId, role });
}

async function membershipExists(userId: string, companyId: string): Promise<boolean> {
  const rows = await db.select().from(membership).where(eq(membership.userId, userId));
  return rows.some((r) => r.companyId === companyId);
}

// repository の findUserById は他テストの mock.module("@/db/repositories/user") 漏れの影響を受けるため、
// アカウント存否は実テーブルを直接見て判定する (mock に依らず actual state を検証する)。
async function userExists(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length > 0;
}

describe("removeMember", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("唯一の所属メンバーを除名 → membership 削除 + account 連動削除", async () => {
    const ownerId = await seedUser("only-owner");
    const memberId = await seedUser("only-member");
    const companyId = await seedCompany("only");
    await join(ownerId, companyId, "OWNER");
    await join(memberId, companyId, "MEMBER");

    const result = await removeMember(ownerId, memberId, companyId, "MEMBER");

    expect(result).toEqual({ accountDeleted: true });
    expect(await membershipExists(memberId, companyId)).toBe(false);
    expect(await userExists(memberId)).toBe(false);
  });

  test("他事業所所属のあるメンバーを除名 → membership のみ削除し account 維持", async () => {
    const ownerId = await seedUser("multi-owner");
    const memberId = await seedUser("multi-member");
    const target = await seedCompany("multi-target");
    const other = await seedCompany("multi-other");
    await join(ownerId, target, "OWNER");
    await join(memberId, target, "MEMBER");
    await join(memberId, other, "MEMBER");

    const result = await removeMember(ownerId, memberId, target, "MEMBER");

    expect(result).toEqual({ accountDeleted: false });
    expect(await membershipExists(memberId, target)).toBe(false);
    expect(await membershipExists(memberId, other)).toBe(true);
    expect(await userExists(memberId)).toBe(true);
  });

  test("最後の OWNER の除名は owner_invariant で reject、membership も account も無変更", async () => {
    const ownerId = await seedUser("last-owner");
    const companyId = await seedCompany("last");
    await join(ownerId, companyId, "OWNER");

    const result = await removeMember(ownerId, ownerId, companyId, "OWNER");

    expect(result).toBe("owner_invariant");
    expect(await membershipExists(ownerId, companyId)).toBe(true);
    expect(await userExists(ownerId)).toBe(true);
  });

  test("本人が唯一の所属を退会 (self leave) → account 連動削除", async () => {
    const ownerId = await seedUser("self-owner");
    const memberId = await seedUser("self-member");
    const companyId = await seedCompany("self");
    await join(ownerId, companyId, "OWNER");
    await join(memberId, companyId, "MEMBER");

    const result = await removeMember(memberId, memberId, companyId, "MEMBER");

    expect(result).toEqual({ accountDeleted: true });
    expect(await userExists(memberId)).toBe(false);
  });
});
