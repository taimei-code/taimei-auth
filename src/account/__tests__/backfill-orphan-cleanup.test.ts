import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany, softDeleteCompany } from "@/db/repositories/company";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { company, membership, session, user } from "@/db/schema";
import { backfillOrphanCleanup } from "../backfill-orphan-cleanup";

const P = "backfill-test-";

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

async function seedCompany(suffix: string, deleted: boolean): Promise<string> {
  const id = generateCompanyId();
  await insertCompany({ id, name: `${P}co-${suffix}`, orgCode: "PERSONAL" });
  if (deleted) await softDeleteCompany(id);
  return id;
}

async function join(userId: string, companyId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
  await insertMembership({ id: generateMembershipId(), userId, companyId, role });
}

async function userExists(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length > 0;
}

async function membershipCount(companyId: string): Promise<number> {
  return (await db.select().from(membership).where(eq(membership.companyId, companyId))).length;
}

// DELETED company に ghost membership を持つ user を 2 名作る: orphan (この事業所のみ) と survivor (別 ACTIVE 所属あり)。
async function seedGhostScenario() {
  const deleted = await seedCompany("ghost", true);
  const active = await seedCompany("active", false);
  const orphan = await seedUser("orphan");
  const survivor = await seedUser("survivor");
  await join(orphan, deleted, "OWNER");
  await join(survivor, deleted, "MEMBER");
  await join(survivor, active, "MEMBER");
  return { deleted, active, orphan, survivor };
}

describe("backfillOrphanCleanup", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  // findDeletedCompanyIdsWithMemberships はグローバルクエリのため、global count ではなく
  // 自テストが作ったエンティティの振る舞いだけを検証する (他データ・残骸に左右されない)。
  test("dry-run: 対象を集計するが一切 mutate しない", async () => {
    const { deleted, orphan, survivor } = await seedGhostScenario();

    const report = await backfillOrphanCleanup({ execute: false });

    expect(report.executed).toBe(false);
    expect(report.deletedUserIds).toContain(orphan);
    expect(report.deletedUserIds).not.toContain(survivor);
    // mutate していないこと
    expect(await membershipCount(deleted)).toBe(2);
    expect(await userExists(orphan)).toBe(true);
  });

  test("execute: ghost membership を物理削除し orphan を連動削除、survivor と ACTIVE 事業所は維持", async () => {
    const { deleted, active, orphan, survivor } = await seedGhostScenario();

    const report = await backfillOrphanCleanup({ execute: true });

    expect(report.executed).toBe(true);
    expect(report.deletedUserIds).toContain(orphan);
    expect(report.deletedUserIds).not.toContain(survivor);
    expect(await membershipCount(deleted)).toBe(0);
    expect(await userExists(orphan)).toBe(false);
    expect(await userExists(survivor)).toBe(true);
    expect(await membershipCount(active)).toBe(1);
  });

  test("ACTIVE 事業所のメンバーは backfill 対象外で削除されない", async () => {
    const active = await seedCompany("only-active", false);
    const u = await seedUser("only");
    await join(u, active, "OWNER");

    const report = await backfillOrphanCleanup({ execute: true });

    expect(report.deletedUserIds).not.toContain(u);
    expect(await userExists(u)).toBe(true);
    expect(await membershipCount(active)).toBe(1);
  });
});
