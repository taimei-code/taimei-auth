import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";

import { db } from "@/db/client";
import { auditLog, company, membership, user } from "@/db/schema";
import { softDeleteCompany } from "@/db/repositories/company";
import { findMembershipsByUserId } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { runLive, runLiveResult } from "../../__tests__/live-runner";
import { addCompany, createSignupCompany } from "../create";

const USER_ID_PREFIX = "create-test-user-";

// この test が作る company は random id なので、対象 user の membership 経由で特定して掃除する。
// FK 制約: membership.company_id は ON DELETE RESTRICT なので company より先に membership を消す。
async function cleanup() {
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.id, `${USER_ID_PREFIX}%`));
  const companyIds = new Set<string>();
  for (const u of users) {
    const ms = await db.select().from(membership).where(eq(membership.userId, u.id));
    for (const m of ms) companyIds.add(m.companyId);
  }
  await db.delete(auditLog).where(like(auditLog.userId, `${USER_ID_PREFIX}%`));
  await db.delete(membership).where(like(membership.userId, `${USER_ID_PREFIX}%`));
  for (const id of companyIds) {
    await db.delete(company).where(eq(company.id, id)); // user.last_used は ON DELETE SET NULL
  }
  await db.delete(user).where(like(user.id, `${USER_ID_PREFIX}%`));
}

async function seedUser(suffix: string): Promise<string> {
  const userId = `${USER_ID_PREFIX}${suffix}`;
  await db.insert(user).values({
    id: userId,
    name: `Test ${suffix}`,
    email: `${userId}@example.com`,
    emailVerified: false,
  });
  return userId;
}

async function countCompanyCreatedAudit(userId: string, companyId: string): Promise<number> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, "company_created")));
  return rows.filter((r) => (r.payload as { company_id?: string }).company_id === companyId).length;
}

describe("createSignupCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("membership 0 件なら作成し OWNER + last_used + audit を残す", async () => {
    const userId = await seedUser("signup-ok");
    const result = await runLiveResult(
      createSignupCompany(userId, { name: "Signup Co", orgCode: "CORPORATE" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.membership.role).toBe("OWNER");
    expect(result.company.activationStatus).toBe("ACTIVE");

    const userRow = await findUserById(userId);
    expect(userRow?.lastUsedCompanyId).toBe(result.company.id);
    expect(await countCompanyCreatedAudit(userId, result.company.id)).toBe(1);
  });

  test("既に membership があれば already_exists を返し新規作成しない", async () => {
    const userId = await seedUser("signup-dup");
    const first = await runLiveResult(
      createSignupCompany(userId, { name: "First", orgCode: "PERSONAL" }),
    );
    expect(first.ok).toBe(true);

    const second = await runLiveResult(
      createSignupCompany(userId, { name: "Second", orgCode: "PERSONAL" }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already_exists");

    const memberships = await findMembershipsByUserId(userId);
    expect(memberships.length).toBe(1);
  });

  // 0 件ガードが ACTIVE 基準であること (根拠: src/company/create.ts) を固定する。
  // 全 membership 基準に退化すると、全削除した user の再 signup が残存 membership に弾かれ
  // /account ⇄ signup/company の redirect loop に陥る。
  test("所属事業所を全削除した後は ACTIVE 0 件として再作成できる", async () => {
    const userId = await seedUser("signup-after-delete");
    const first = await runLiveResult(
      createSignupCompany(userId, { name: "First", orgCode: "PERSONAL" }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await softDeleteCompany(first.company.id);

    const second = await runLiveResult(
      createSignupCompany(userId, { name: "Second", orgCode: "CORPORATE" }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.membership.role).toBe("OWNER");
    expect(second.company.activationStatus).toBe("ACTIVE");

    const active = (await findMembershipsByUserId(userId)).filter(
      (m) => m.companyActivationStatus === "ACTIVE",
    );
    expect(active.length).toBe(1);
    expect(active.at(0)?.companyId).toBe(second.company.id);
  });
});

describe("addCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("既存 membership があっても作成し OWNER + last_used 更新 + audit を残す", async () => {
    const userId = await seedUser("add-existing");
    const first = await runLiveResult(
      createSignupCompany(userId, { name: "Base", orgCode: "CORPORATE" }),
    );
    expect(first.ok).toBe(true);

    const added = await runLive(addCompany(userId, { name: "Added", orgCode: "CORPORATE" }));
    expect(added.membership.role).toBe("OWNER");

    const userRow = await findUserById(userId);
    expect(userRow?.lastUsedCompanyId).toBe(added.company.id); // 新事業所へ切替
    expect(await countCompanyCreatedAudit(userId, added.company.id)).toBe(1);

    const memberships = await findMembershipsByUserId(userId);
    expect(memberships.length).toBe(2);
  });

  test("個人事業主を 2 つ作れる (制限なし)", async () => {
    const userId = await seedUser("add-personal-dup");
    const one = await runLive(addCompany(userId, { name: "Personal 1", orgCode: "PERSONAL" }));
    const two = await runLive(addCompany(userId, { name: "Personal 2", orgCode: "PERSONAL" }));

    expect(one.company.id).not.toBe(two.company.id);
    expect(one.company.orgCode).toBe("PERSONAL");
    expect(two.company.orgCode).toBe("PERSONAL");

    const memberships = await findMembershipsByUserId(userId);
    expect(memberships.length).toBe(2);

    const userRow = await findUserById(userId);
    expect(userRow?.lastUsedCompanyId).toBe(two.company.id); // 最後に作った方が current
  });
});
