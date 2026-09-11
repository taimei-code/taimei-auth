import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "../client";
import { ROLES } from "../schema";
import { readInvitation, readMembership } from "../testing/read";
import { createSeed } from "../testing/seed";

const seed = createSeed("dbrole-test-");

const insertMembershipRaw = (userId: string, companyId: string, role: string) =>
  db.execute(
    sql`INSERT INTO membership (id, user_id, company_id, role) VALUES (${`mbr_raw_${userId}`}, ${userId}, ${companyId}, ${role})`,
  );

// drizzle は driver error を DrizzleQueryError で包み、制約名は cause 側にしか出ない。
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
