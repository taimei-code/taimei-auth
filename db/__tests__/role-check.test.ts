import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { db } from "../client";
import { ORG_CODES, ROLES } from "../enums";
import * as schema from "../schema";
import { readInvitation, readMembership } from "../testing/read";
import { createSeed } from "../testing/seed";

const seed = createSeed("dbrole-test-");

const insertMembershipRaw = (userId: string, companyId: string, role: string) =>
  db.execute(
    sql`INSERT INTO membership (id, user_id, company_id, role) VALUES (${`mbr_raw_${userId}`}, ${userId}, ${companyId}, ${role})`,
  );

const expectCheckViolation = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const err = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeDefined();
  expect(String((err as { cause?: unknown }).cause ?? err)).toContain(constraint);
};

describe("role CHECK constraint (ADR-0018)", () => {
  beforeAll(seed.cleanup);
  afterAll(seed.cleanup);

  test("ROLES の全値が membership に INSERT できる", async () => {
    const co = await seed.seedCompany("all");
    for (const role of ROLES) {
      const u = await seed.seedUser(`m-${role}`);
      await seed.seedMembership(u.id, co, role);
      expect((await readMembership(u.id, co))?.role).toBe(role);
    }
  });

  test("ROLES の全値が invitation に INSERT できる", async () => {
    const owner = await seed.seedUser("inv-owner");
    const co = await seed.seedCompany("inv");
    for (const role of ROLES) {
      const inv = await seed.seedInvitation({
        companyId: co,
        email: `${role}@x.test`,
        role,
        invitedByUserId: owner.id,
      });
      expect((await readInvitation(inv.id))?.role).toBe(role);
    }
  });

  test("membership.role の外れ値 ('SUPERVISOR' / 'owner' / '') は membership_role_check で reject、'OWNER' は成功", async () => {
    const co = await seed.seedCompany("edge");
    for (const bad of ["SUPERVISOR", "owner", ""]) {
      const u = await seed.seedUser(`edge-${bad || "empty"}`);
      await expectCheckViolation(() => insertMembershipRaw(u.id, co, bad), "membership_role_check");
    }
    const ok = await seed.seedUser("edge-ok");
    await insertMembershipRaw(ok.id, co, "OWNER");
    expect((await readMembership(ok.id, co))?.role).toBe("OWNER");
  });

  test("invitation.role = 'SUPERVISOR' は invitation_role_check で reject", async () => {
    const owner = await seed.seedUser("bad-i");
    const co = await seed.seedCompany("bad-i");
    await expectCheckViolation(
      () =>
        db.execute(
          sql`INSERT INTO invitation (id, company_id, email, role, token, expires_at, invited_by_user_id)
              VALUES ('inv_raw_bad', ${co}, 'bad@example.com', 'SUPERVISOR', 'tok_raw_bad', now() + interval '1 day', ${owner.id})`,
        ),
      "invitation_role_check",
    );
  });

  test("既存 membership を 'SUPERVISOR' へ UPDATE すると reject され role は不変", async () => {
    const u = await seed.seedUser("upd");
    const co = await seed.seedCompany("upd");
    await seed.seedMembership(u.id, co, "OWNER");
    await expectCheckViolation(
      () =>
        db.execute(
          sql`UPDATE membership SET role = 'SUPERVISOR' WHERE user_id = ${u.id} AND company_id = ${co}`,
        ),
      "membership_role_check",
    );
    expect((await readMembership(u.id, co))?.role).toBe("OWNER");
  });
});

describe("company.org_code の CHECK 制約", () => {
  beforeAll(seed.cleanup);
  afterAll(seed.cleanup);

  test("ORG_CODES の全値で company を作れる", async () => {
    for (const orgCode of ORG_CODES) {
      const co = await seed.seedCompany(`org-${orgCode}`, orgCode);
      expect(co).toBeString();
    }
  });

  test("既存の company を 'GOVERNMENT' へ UPDATE すると company_org_code_check で reject", async () => {
    const co = await seed.seedCompany("org-bad");
    await expectCheckViolation(
      () => db.execute(sql`UPDATE company SET org_code = 'GOVERNMENT' WHERE id = ${co}`),
      "company_org_code_check",
    );
  });
});

describe("CHECK 制約の SQL", () => {
  test("CHECK 制約は値を placeholder ($1) にせず SQL に埋め込む (placeholder のままだと drizzle-kit の migration で制約が壊れる)", () => {
    const dialect = new PgDialect();
    const checks = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .flatMap((table) => getTableConfig(table).checks);
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) expect(dialect.sqlToQuery(check.value).params).toEqual([]);
  });
});
