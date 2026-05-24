import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId, insertCompany } from "../repositories/company";
import {
  OwnerInvariantViolation,
  generateMembershipId,
  insertMembership,
  withOwnerLockGuard,
} from "../repositories/membership";
import { company, membership, user } from "../schema";
import { runInTransaction } from "../transaction";

const USER_ID_PREFIX = "mem-test-user-";
const COMPANY_NAME_PREFIX = "mem-test-co-";

async function cleanupTestData() {
  await db.delete(membership).where(like(membership.userId, `${USER_ID_PREFIX}%`));
  await db.delete(company).where(like(company.name, `${COMPANY_NAME_PREFIX}%`));
  await db.delete(user).where(like(user.id, `${USER_ID_PREFIX}%`));
}

async function seedUserCompanyOwner(suffix: string) {
  const userId = `${USER_ID_PREFIX}${suffix}`;
  const companyId = generateCompanyId();
  await db.insert(user).values({
    id: userId,
    name: `Test ${suffix}`,
    email: `mem-${suffix}@example.com`,
    emailVerified: false,
  });
  await insertCompany({
    id: companyId,
    name: `${COMPANY_NAME_PREFIX}${suffix}`,
    orgCode: "PERSONAL",
  });
  await insertMembership({
    id: generateMembershipId(),
    userId,
    companyId,
    role: "OWNER",
  });
  return { userId, companyId };
}

describe("withOwnerLockGuard", () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  test("最後の OWNER を抜く操作は OwnerInvariantViolation で reject", async () => {
    const { userId, companyId } = await seedUserCompanyOwner("last-owner");
    await expect(
      runInTransaction((tx) =>
        withOwnerLockGuard(tx, companyId, async (tx2) => {
          await tx2.delete(membership).where(eq(membership.userId, userId));
        }),
      ),
    ).rejects.toBeInstanceOf(OwnerInvariantViolation);

    const remaining = await db.select().from(membership).where(eq(membership.companyId, companyId));
    expect(remaining.length).toBe(1);
  });

  test("OWNER ≥ 1 が残るなら fn の実行を許可", async () => {
    const { companyId } = await seedUserCompanyOwner("dual-owner");
    const secondUserId = `${USER_ID_PREFIX}dual-owner-2`;
    await db.insert(user).values({
      id: secondUserId,
      name: "Owner 2",
      email: "mem-owner2@example.com",
      emailVerified: false,
    });
    await insertMembership({
      id: generateMembershipId(),
      userId: secondUserId,
      companyId,
      role: "OWNER",
    });

    await runInTransaction((tx) =>
      withOwnerLockGuard(tx, companyId, async (tx2) => {
        await tx2.delete(membership).where(eq(membership.userId, secondUserId));
      }),
    );

    const owners = await db.select().from(membership).where(eq(membership.companyId, companyId));
    expect(owners.length).toBe(1);
  });
});
