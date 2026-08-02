import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany, softDeleteCompany } from "@/db/repositories/company";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { auditLog, company, membership, session, user } from "@/db/schema";
import { runInTransaction } from "@/db/transaction";
import { getRedis } from "../../redis";
import { deleteAccountIfOrphaned } from "../orphan";

const P = "orphan-test-";

async function cleanup() {
  await db.delete(auditLog).where(like(auditLog.userId, `${P}%`));
  await db.delete(session).where(like(session.userId, `${P}%`));
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
  const redis = await getRedis();
  await redis.del([
    `${P}rtok-1`,
    `${P}rtok-2`,
    `active-sessions-${P}u-redis`,
    `${P}rtok-kept`,
    `active-sessions-${P}u-rkept`,
  ]);
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

// better-auth secondaryStorage の実保存形状を再現する: session 実体は token 文字列キー、
// user の生存 session 一覧は active-sessions-{userId} (deleteUserSessions が読む索引)。
async function seedRedisSessions(userId: string, tokens: string[]): Promise<void> {
  const redis = await getRedis();
  const expiresAt = Date.now() + 86_400_000;
  for (const token of tokens) {
    await redis.set(token, JSON.stringify({ session: { token, userId, expiresAt }, user: {} }));
  }
  await redis.set(
    `active-sessions-${userId}`,
    JSON.stringify(tokens.map((token) => ({ token, expiresAt }))),
  );
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

  // secondaryStorage 構成では session の実体は Redis のみ (Postgres session テーブルは常に空)。
  // DB 側の revoke だけでは削除済み user の session が生き残り、その cookie で事業所作成を叩くと
  // membership insert が FK 違反 500 になる実障害があった。orphan 削除は Redis 側も purge すること。
  test("orphan 削除は secondaryStorage (Redis) の session 実体と索引も purge する", async () => {
    const userId = await seedUser("redis");
    const tokens = [`${P}rtok-1`, `${P}rtok-2`];
    await seedRedisSessions(userId, tokens);

    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));

    const redis = await getRedis();
    expect(deleted).toBe(true);
    expect(await redis.get(`${P}rtok-1`)).toBeNull();
    expect(await redis.get(`${P}rtok-2`)).toBeNull();
    expect(await redis.get(`active-sessions-${userId}`)).toBeNull();
  });

  test("membership が残り削除しない場合は Redis session に触れない", async () => {
    const userId = await seedUser("rkept");
    const companyId = await seedCompany("rkept");
    await insertMembership({ id: generateMembershipId(), userId, companyId, role: "OWNER" });
    await seedRedisSessions(userId, [`${P}rtok-kept`]);

    const deleted = await runInTransaction((tx) => deleteAccountIfOrphaned(userId, tx));

    const redis = await getRedis();
    expect(deleted).toBe(false);
    expect(await redis.get(`${P}rtok-kept`)).not.toBeNull();
    expect(await redis.get(`active-sessions-${userId}`)).not.toBeNull();
  });
});
