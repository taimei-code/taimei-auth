import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany, softDeleteCompany } from "@/db/repositories/company";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { auditLog, company, membership, session, user } from "@/db/schema";
import { runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "../orphan";

const P = "orphan-test-";

async function cleanup() {
  await db.delete(auditLog).where(like(auditLog.userId, `${P}%`));
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

async function countAccountDeleteAudit(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, "account_delete")));
  return rows.length;
}

describe("deleteAccountIfOrphaned", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("active membership 0 件なら account を削除し session 消滅 + audit を残す (true)", async () => {
    const userId = await seedUser("orphan");

    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));

    expect(deleted).toBe(true);
    expect(await findUserById(userId)).toBeUndefined();
    const sessions = await db.select().from(session).where(eq(session.userId, userId));
    expect(sessions.length).toBe(0); // user cascade で物理消滅
    expect(await countAccountDeleteAudit(userId)).toBe(1);
  });

  test("active membership が残るなら削除しない (false)、account 維持", async () => {
    const userId = await seedUser("kept");
    const companyId = await seedCompany("kept");
    await insertMembership({ id: generateMembershipId(), userId, companyId, role: "OWNER" });

    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));

    expect(deleted).toBe(false);
    expect(await findUserById(userId)).toBeDefined();
    expect(await countAccountDeleteAudit(userId)).toBe(0);
  });

  test("DELETED company の残存 membership だけなら orphan 扱いで削除 (true)", async () => {
    const userId = await seedUser("ghost");
    const companyId = await seedCompany("ghost");
    await insertMembership({ id: generateMembershipId(), userId, companyId, role: "OWNER" });
    await softDeleteCompany(companyId);

    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));

    expect(deleted).toBe(true);
    expect(await findUserById(userId)).toBeUndefined();
  });

  test("既に存在しない user への適用は二重削除せず安全 (true / no-op)", async () => {
    const userId = `${P}u-absent`;
    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));
    expect(deleted).toBe(true);
  });
});
