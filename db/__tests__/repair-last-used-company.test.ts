import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { like, sql } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId, insertCompany, softDeleteCompany } from "../repositories/company";
import { generateMembershipId, insertMembership } from "../repositories/membership";
import { company, membership, user } from "../schema";
import type { DbTx } from "../transaction";

const P = "repairlu-test-";
const REPAIR_SQL = readFileSync(
  new URL("../../drizzle/manual/0005_repair_last_used_company.sql", import.meta.url),
  "utf-8",
);

class Rollback extends Error {}

async function cleanup() {
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
}

async function seedUser(tx: DbTx, suffix: string, lastUsedCompanyId: string | null) {
  const id = `${P}u-${suffix}`;
  await tx.insert(user).values({
    id,
    name: `U ${suffix}`,
    email: `${P}${suffix}@example.com`,
    lastUsedCompanyId,
  });
  return id;
}

async function seedCompany(tx: DbTx, suffix: string) {
  const id = generateCompanyId();
  await insertCompany({ id, name: `${P}co-${suffix}`, orgCode: "PERSONAL" }, tx);
  return id;
}

const join = (tx: DbTx, userId: string, companyId: string) =>
  insertMembership({ id: generateMembershipId(), userId, companyId, role: "MEMBER" }, tx);

async function lastUsedOf(tx: DbTx, userId: string) {
  const rows = await tx.execute<{ last_used_company_id: string | null }>(
    sql`SELECT last_used_company_id FROM "user" WHERE id = ${userId}`,
  );
  return rows.rows[0]?.last_used_company_id;
}

// SQL は user の全行を対象にするので、他の test の行を変えないように tx ごと rollback する。
const inRolledBackTx = (body: (tx: DbTx) => Promise<void>) =>
  db
    .transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });

describe("drizzle/manual/0005_repair_last_used_company.sql", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("current 事業所が ACTIVE の所属を指さない行だけを直し、2 回目は 0 行", () =>
    inRolledBackTx(async (tx) => {
      const active = await seedCompany(tx, "active");
      const second = await seedCompany(tx, "second");
      const left = await seedCompany(tx, "left");
      const deleted = await seedCompany(tx, "deleted");
      await softDeleteCompany(deleted, tx);

      const removed = await seedUser(tx, "removed", left);
      await join(tx, removed, active);
      const nulled = await seedUser(tx, "nulled", null);
      await join(tx, nulled, active);
      const ghost = await seedUser(tx, "ghost", deleted);
      await join(tx, ghost, deleted);
      const valid = await seedUser(tx, "valid", second);
      await join(tx, valid, active);
      await join(tx, valid, second);
      const alone = await seedUser(tx, "alone", null);

      const first = await tx.execute(sql.raw(REPAIR_SQL));

      expect(first.rowCount).toBeGreaterThanOrEqual(3);
      expect(await lastUsedOf(tx, removed)).toBe(active);
      expect(await lastUsedOf(tx, nulled)).toBe(active);
      expect(await lastUsedOf(tx, ghost)).toBeNull();
      expect(await lastUsedOf(tx, valid)).toBe(second);
      expect(await lastUsedOf(tx, alone)).toBeNull();
      expect((await tx.execute(sql.raw(REPAIR_SQL))).rowCount).toBe(0);
    }));
});
