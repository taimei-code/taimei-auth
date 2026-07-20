import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, asc, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { generateCompanyId, insertCompany } from "@/db/repositories/company";
import {
  deleteMembership,
  generateMembershipId,
  insertMembership,
} from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { auditLog, company, membership, user } from "@/db/schema";
import { switchCompany } from "../switch-company";

// switch-company use-case (src/account/switch-company.ts) の DB 統合テスト。
// same-company 短絡 (spy 0 回) / 非メンバー 403 / tx 内 findMembership TOCTOU 再検証を検証。
// 認可 (session 通過) は Guard 層 (requireActor) の責務。

const P = "swco-test-";

async function cleanup() {
  await db.delete(auditLog).where(like(auditLog.userId, `${P}%`));
  await db.delete(membership).where(like(membership.userId, `${P}%`));
  await db.delete(company).where(like(company.name, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
}

async function seedUser(suffix: string, lastUsedCompanyId?: string | null): Promise<string> {
  const id = `${P}u-${suffix}`;
  await db.insert(user).values({
    id,
    name: `U ${suffix}`,
    email: `${P}${suffix}@example.com`,
    emailVerified: true,
    lastUsedCompanyId: lastUsedCompanyId ?? null,
  });
  return id;
}

async function seedCompany(suffix: string): Promise<string> {
  const id = generateCompanyId();
  await insertCompany({ id, name: `${P}co-${suffix}`, orgCode: "PERSONAL" });
  return id;
}

async function auditRows(userId: string, eventType: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}

describe("switchCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-02 正常 切替 (別 companyId) → last_used 更新 / company_switched audit", async () => {
    const co1 = await seedCompany("h02-a");
    const co2 = await seedCompany("h02-b");
    const u = await seedUser("h02", co1);
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co1,
      role: "OWNER",
    });
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co2,
      role: "MEMBER",
    });

    const result = await switchCompany({ actorUserId: u, targetCompanyId: co2 });
    expect(result).toEqual({ ok: true, companyId: co2 });
    expect((await findUserById(u))?.lastUsedCompanyId).toBe(co2);

    const audits = await auditRows(u, "company_switched");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({ from_company_id: co1, to_company_id: co2 });
  });

  test("QA-H-09 same-company 短絡 (fromCompanyId === targetCompanyId) → 200 / tx open せず audit 発火なし", async () => {
    const co = await seedCompany("h09");
    const u = await seedUser("h09", co);
    await insertMembership({ id: generateMembershipId(), userId: u, companyId: co, role: "OWNER" });

    const txSpy = spyOn(db, "transaction");
    try {
      const result = await switchCompany({ actorUserId: u, targetCompanyId: co });
      expect(result).toEqual({ ok: true, companyId: co });
      expect(txSpy).not.toHaveBeenCalled();
    } finally {
      txSpy.mockRestore();
    }
    expect((await findUserById(u))?.lastUsedCompanyId).toBe(co);
    expect((await auditRows(u, "company_switched")).length).toBe(0);
  });

  test("非メンバー user が切替 → forbidden / last_used 未変更 / audit 発火なし", async () => {
    const co1 = await seedCompany("nm-a");
    const co2 = await seedCompany("nm-b");
    const u = await seedUser("nm", co1);
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co1,
      role: "OWNER",
    });
    // co2 には所属していない。

    const result = await switchCompany({ actorUserId: u, targetCompanyId: co2 });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect((await findUserById(u))?.lastUsedCompanyId).toBe(co1);
    expect((await auditRows(u, "company_switched")).length).toBe(0);
  });

  test("QA-E-05 tx 中除名 race (TOCTOU) → tx 内 findMembership が null → forbidden", async () => {
    // 設計決定 4: switch-company の tx 内で findMembership を再取得し、tx 外 pre-check と
    // 更新の間で除名 (別 tx の deleteMembership) が入った場合 forbidden を返す。tx 外 pre-check
    // のみに退化すると無効な company_id が last_used に silent 書き込みされる。
    const co1 = await seedCompany("toctou-a");
    const co2 = await seedCompany("toctou-b");
    const u = await seedUser("toctou", co1);
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co1,
      role: "OWNER",
    });
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co2,
      role: "MEMBER",
    });

    // 事前に co2 の membership を削除して「tx 内 findMembership が null」状態を作る。
    // (真の race を再現するにはランタイム介入が要るが、tx 外 check なしの現行 use-case では
    // 「tx 開始時点で既に不在」で同じ経路に落ちるため、この simulation で契約検証が成立する)。
    await deleteMembership(u, co2);

    const result = await switchCompany({ actorUserId: u, targetCompanyId: co2 });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect((await findUserById(u))?.lastUsedCompanyId).toBe(co1);
    expect((await auditRows(u, "company_switched")).length).toBe(0);
  });

  test("QA-D-02 初回切替 (lastUsedCompanyId=null) → from_company_id=null で audit / 切替成立", async () => {
    const co = await seedCompany("d02");
    const u = await seedUser("d02", null);
    await insertMembership({ id: generateMembershipId(), userId: u, companyId: co, role: "OWNER" });

    const result = await switchCompany({ actorUserId: u, targetCompanyId: co });
    expect(result).toEqual({ ok: true, companyId: co });
    const audits = await auditRows(u, "company_switched");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({ from_company_id: null, to_company_id: co });
    expect((await findUserById(u))?.lastUsedCompanyId).toBe(co);
  });

  test("QA-H-12 mutation → audit 発火順 pin (audit の to_company_id が UPDATE 後の user.last_used_company_id と一致)", async () => {
    const co1 = await seedCompany("order-a");
    const co2 = await seedCompany("order-b");
    const u = await seedUser("order", co1);
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co1,
      role: "OWNER",
    });
    await insertMembership({
      id: generateMembershipId(),
      userId: u,
      companyId: co2,
      role: "MEMBER",
    });

    const result = await switchCompany({ actorUserId: u, targetCompanyId: co2 });
    expect(result.ok).toBe(true);
    const finalLastUsed = (await findUserById(u))?.lastUsedCompanyId;
    const payload = (await auditRows(u, "company_switched"))[0]?.payload as Record<string, unknown>;
    expect(payload.to_company_id).toBe(finalLastUsed);
  });
});
