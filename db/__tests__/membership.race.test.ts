import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId, insertCompany } from "../repositories/company";
import {
  OwnerInvariantViolation,
  deleteMembership,
  generateMembershipId,
  insertMembership,
  withOwnerLockGuard,
} from "../repositories/membership";
import { company, membership, user } from "../schema";
import { runInTransaction } from "../transaction";

const USER_ID_PREFIX = "race-test-user-";
const COMPANY_NAME_PREFIX = "race-test-co-";

async function cleanup() {
  await db.delete(membership).where(like(membership.userId, `${USER_ID_PREFIX}%`));
  await db.delete(company).where(like(company.name, `${COMPANY_NAME_PREFIX}%`));
  await db.delete(user).where(like(user.id, `${USER_ID_PREFIX}%`));
}

// 2 OWNER の company を seed。両 OWNER が同時に「自分が抜ける」操作をした時、
// SELECT ... FOR UPDATE で直列化され、後発は OWNER ≥ 1 を割るため reject されることを検証する。
async function seedTwoOwners(suffix: string) {
  const companyId = generateCompanyId();
  await insertCompany({
    id: companyId,
    name: `${COMPANY_NAME_PREFIX}${suffix}`,
    orgCode: "CORPORATE",
  });
  const owners: string[] = [];
  for (const n of [1, 2]) {
    const userId = `${USER_ID_PREFIX}${suffix}-${n}`;
    await db.insert(user).values({
      id: userId,
      name: `Owner ${n}`,
      email: `${USER_ID_PREFIX}${suffix}-${n}@example.com`,
      emailVerified: false,
    });
    await insertMembership({
      id: generateMembershipId(),
      userId,
      companyId,
      role: "OWNER",
    });
    owners.push(userId);
  }
  return { companyId, owners };
}

const leaveAsOwner = (companyId: string, userId: string) =>
  runInTransaction((tx) =>
    withOwnerLockGuard(tx, companyId, async (tx2) => {
      // 100ms sleep を挟んで 2 transaction を確実に重ね、FOR UPDATE による直列化を検証する。
      await new Promise((r) => setTimeout(r, 100));
      await deleteMembership(userId, companyId, tx2);
    }),
  );

describe("OWNER race: 2 OWNER 同時退会で 1 名残し reject", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  // flake 検知のため 5 回連続で同じ不変条件 (1 成功 / 1 reject / OWNER 残 1) を要求する。
  for (let iteration = 1; iteration <= 5; iteration++) {
    test(`iteration ${iteration}: 並行退会の片方のみ成功し OWNER は 1 名残る`, async () => {
      const { companyId, owners } = await seedTwoOwners(`it${iteration}`);

      const results = await Promise.allSettled([
        leaveAsOwner(companyId, owners[0] as string),
        leaveAsOwner(companyId, owners[1] as string),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OwnerInvariantViolation);

      const remaining = await db
        .select()
        .from(membership)
        .where(eq(membership.companyId, companyId));
      expect(remaining.length).toBe(1);
      expect(remaining[0]?.role).toBe("OWNER");
    });
  }
});
