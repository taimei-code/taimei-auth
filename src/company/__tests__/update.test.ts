import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findCompanyById, softDeleteCompany } from "@/db/repositories/company";
import { auditLog } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { updateCompanyInfo } from "../update";

// company/update use-case (src/company/update.ts) の DB 統合テスト。
// tx 内 before/after diff / inactive → rollback (404) で audit 非発火 を検証。
// 認可 (OWNER のみ) は Guard 層 (requireMembership "OWNER") の責務。

const P = "coupd-test-";
const { cleanup, seedUser, seedCompany, seedMembership } = createSeedHelpers(P);

async function auditRows(userId: string, eventType: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}

describe("updateCompanyInfo", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-03 正常 更新 → company 行更新 / company_updated audit に before/after diff", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("h03");
    await seedMembership(owner.id, co, "OWNER");
    const before = await findCompanyById(co);
    if (!before) throw new Error("seed failed");

    const result = await updateCompanyInfo({
      actorUserId: owner.id,
      companyId: co,
      input: { name: `${P}renamed`, orgCode: "CORPORATE" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.company.name).toBe(`${P}renamed`);
    expect(result.company.orgCode).toBe("CORPORATE");

    const after = await findCompanyById(co);
    expect(after?.name).toBe(`${P}renamed`);
    expect(after?.orgCode).toBe("CORPORATE");

    const audits = await auditRows(owner.id, "company_updated");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      company_id: co,
      before: { name: before.name, org_code: before.orgCode },
      after: { name: `${P}renamed`, org_code: "CORPORATE" },
    });
  });

  test("QA-D-06 inactive company → not_found Result / update rollback / audit 発火なし", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("d06");
    await seedMembership(owner.id, co, "OWNER");
    await softDeleteCompany(co);

    const result = await updateCompanyInfo({
      actorUserId: owner.id,
      companyId: co,
      input: { name: `${P}renamed`, orgCode: "CORPORATE" },
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });

    // rollback: audit 発火なし + company 状態 unchanged (name / orgCode)
    const after = await findCompanyById(co);
    expect(after?.name).toBe(`${P}co-d06`);
    expect(after?.activationStatus).toBe("DELETED");
    expect((await auditRows(owner.id, "company_updated")).length).toBe(0);
  });

  test("QA-E-11 not_found 経路の rollback → mutation なし + audit 非発火", async () => {
    // updateCompany は存在しない companyId で 0 件更新 → not_found。tx 内 audit も rollback で消える。
    const owner = await seedUser("owner");
    const co = await seedCompany("e11-existing");
    await seedMembership(owner.id, co, "OWNER");

    const result = await updateCompanyInfo({
      actorUserId: owner.id,
      companyId: `${P}nonexistent`,
      input: { name: `${P}renamed`, orgCode: "CORPORATE" },
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((await auditRows(owner.id, "company_updated")).length).toBe(0);
  });

  test("QA-H-12 mutation → audit 発火順 pin (audit.payload.after が UPDATE 完了後の DB state と一致)", async () => {
    // ADR-0012 の invariant: mutation を audit の前に同 tx で emit する。UPDATE 完了後の
    // company 行 (findCompanyById の返す name / org_code) と audit.after が一致することで、
    // 順序が逆 (audit を先に写像 → UPDATE で変更) の regression を検知する。
    const owner = await seedUser("owner-order");
    const co = await seedCompany("h12", "PERSONAL");
    await seedMembership(owner.id, co, "OWNER");

    const result = await updateCompanyInfo({
      actorUserId: owner.id,
      companyId: co,
      input: { name: `${P}h12-renamed`, orgCode: "CORPORATE" },
    });
    expect(result.ok).toBe(true);

    const after = await findCompanyById(co);
    const payload = (await auditRows(owner.id, "company_updated"))[0]?.payload as Record<
      string,
      unknown
    >;
    expect((payload.after as Record<string, unknown>).name).toBe(after?.name);
    expect((payload.after as Record<string, unknown>).org_code).toBe(after?.orgCode);
  });
});
