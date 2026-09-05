import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany } from "@/db/repositories/company";
import { generateMembershipId, insertMembership } from "@/db/repositories/membership";
import { company, membership, session, user } from "@/db/schema";
import { runLive } from "../../__tests__/live-runner";
import { sweepAbandonedSignups } from "../sweep-abandoned-signups";

const TTL_MS = 24 * 60 * 60 * 1000;
const P = "sweep-test-";

async function cleanup() {
  await db.delete(session).where(like(session.userId, `${P}%`));
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
}

async function seedUserAt(suffix: string, createdAt: Date): Promise<string> {
  const id = `${P}u-${suffix}`;
  await db.insert(user).values({
    id,
    name: `U ${suffix}`,
    email: `${P}${suffix}@example.com`,
    emailVerified: false,
    createdAt,
  });
  await db.insert(session).values({
    id: `${P}s-${suffix}`,
    token: `${P}tok-${suffix}`,
    userId: id,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return id;
}

async function userExists(id: string): Promise<boolean> {
  return (await db.select().from(user).where(eq(user.id, id))).length > 0;
}

// signup 登録途中放棄 (古い 0 件) / 直近 signup (新しい 0 件) / 所属あり (古いが ACTIVE 所属) を作る。
async function seedScenario() {
  const old = new Date(Date.now() - 2 * TTL_MS);
  const oldOrphan = await seedUserAt("old-orphan", old);
  const recentOrphan = await seedUserAt("recent-orphan", new Date());
  const oldWithCompany = await seedUserAt("old-withco", old);
  const companyId = generateCompanyId();
  await insertCompany({ id: companyId, name: `${P}co-withco`, orgCode: "PERSONAL" });
  await insertMembership({
    id: generateMembershipId(),
    userId: oldWithCompany,
    companyId,
    role: "OWNER",
  });
  return { oldOrphan, recentOrphan, oldWithCompany };
}

describe("sweepAbandonedSignups", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("dry-run: 24h 超過 + 所属 0 件のみ候補に挙げ mutate しない", async () => {
    const { oldOrphan, recentOrphan, oldWithCompany } = await seedScenario();

    const report = await runLive(sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: false }));

    expect(report.executed).toBe(false);
    expect(report.deletedUserIds).toContain(oldOrphan);
    expect(report.deletedUserIds).not.toContain(recentOrphan);
    expect(report.deletedUserIds).not.toContain(oldWithCompany);
    expect(await userExists(oldOrphan)).toBe(true); // mutate していない
  });

  test("execute: 古い orphan を削除し、24h 内 / 所属あり は残す", async () => {
    const { oldOrphan, recentOrphan, oldWithCompany } = await seedScenario();

    const report = await runLive(sweepAbandonedSignups({ olderThanMs: TTL_MS, execute: true }));

    expect(report.executed).toBe(true);
    expect(report.deletedUserIds).toContain(oldOrphan);
    expect(report.deletedUserIds).not.toContain(recentOrphan);
    expect(await userExists(oldOrphan)).toBe(false);
    expect(await userExists(recentOrphan)).toBe(true);
    expect(await userExists(oldWithCompany)).toBe(true);
  });
});
