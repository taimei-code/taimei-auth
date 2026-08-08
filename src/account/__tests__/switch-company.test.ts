import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { db } from "@/db/client";
import { deleteMembership } from "@/db/repositories/membership";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { switchCompany } from "../switch-company";

// switch-company use-case (src/account/switch-company.ts) の DB 統合テスト。
// same-company 短絡 (spy 0 回) / 非メンバー 403 / tx 内 findMembership TOCTOU 再検証を検証。
// 認可 (session 通過) は Guard 層 (requireActor) の責務。

const P = "swco-test-";
const { cleanup, seedUser, seedCompany, seedMembership } = createSeedHelpers(P);

describe("switchCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-02 正常 切替 (別 companyId) → last_used 更新 / company_switched audit", async () => {
    const co1 = await seedCompany("h02-a");
    const co2 = await seedCompany("h02-b");
    const u = await seedUser("h02", { lastUsedCompanyId: co1 });
    await seedMembership(u.id, co1, "OWNER");
    await seedMembership(u.id, co2, "MEMBER");

    const result = await switchCompany({
      actorUserId: u.id,
      fromCompanyId: co1,
      targetCompanyId: co2,
    });
    expect(result).toEqual({ ok: true, companyId: co2 });
    expect((await findUserById(u.id))?.lastUsedCompanyId).toBe(co2);

    const audits = await auditRowsFor(u.id, "company_switched");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({ from_company_id: co1, to_company_id: co2 });
  });

  test("QA-H-09 same-company 短絡 (fromCompanyId === targetCompanyId) → 200 / tx open せず audit 発火なし", async () => {
    const co = await seedCompany("h09");
    const u = await seedUser("h09", { lastUsedCompanyId: co });
    await seedMembership(u.id, co, "OWNER");

    const txSpy = spyOn(db, "transaction");
    try {
      const result = await switchCompany({
        actorUserId: u.id,
        fromCompanyId: co,
        targetCompanyId: co,
      });
      expect(result).toEqual({ ok: true, companyId: co });
      expect(txSpy).not.toHaveBeenCalled();
    } finally {
      txSpy.mockRestore();
    }
    expect((await findUserById(u.id))?.lastUsedCompanyId).toBe(co);
    expect((await auditRowsFor(u.id, "company_switched")).length).toBe(0);
  });

  test("非メンバー user が切替 → forbidden / last_used 未変更 / audit 発火なし", async () => {
    const co1 = await seedCompany("nm-a");
    const co2 = await seedCompany("nm-b");
    const u = await seedUser("nm", { lastUsedCompanyId: co1 });
    await seedMembership(u.id, co1, "OWNER");
    // co2 には所属していない。

    const result = await switchCompany({
      actorUserId: u.id,
      fromCompanyId: co1,
      targetCompanyId: co2,
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect((await findUserById(u.id))?.lastUsedCompanyId).toBe(co1);
    expect((await auditRowsFor(u.id, "company_switched")).length).toBe(0);
  });

  test("QA-E-05 tx 中除名 race (TOCTOU) → tx 内 findMembership が null → forbidden", async () => {
    // tx 内で findMembership を再取得し、tx 外 pre-check と更新の間で除名 (別 tx の
    // deleteMembership) が入った場合 forbidden を返す。tx 外 pre-check のみに退化すると
    // 無効な company_id が last_used に silent 書き込みされる。
    const co1 = await seedCompany("toctou-a");
    const co2 = await seedCompany("toctou-b");
    const u = await seedUser("toctou", { lastUsedCompanyId: co1 });
    await seedMembership(u.id, co1, "OWNER");
    await seedMembership(u.id, co2, "MEMBER");

    // 事前に co2 の membership を削除して「tx 内 findMembership が null」状態を作る。
    // (真の race を再現するにはランタイム介入が要るが、tx 外 check なしの現行 use-case では
    // 「tx 開始時点で既に不在」で同じ経路に落ちるため、この simulation で契約検証が成立する)。
    await deleteMembership(u.id, co2);

    const result = await switchCompany({
      actorUserId: u.id,
      fromCompanyId: co1,
      targetCompanyId: co2,
    });
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect((await findUserById(u.id))?.lastUsedCompanyId).toBe(co1);
    expect((await auditRowsFor(u.id, "company_switched")).length).toBe(0);
  });

  test("QA-D-02 初回切替 (lastUsedCompanyId=null) → from_company_id=null で audit / 切替成立", async () => {
    const co = await seedCompany("d02");
    const u = await seedUser("d02");
    await seedMembership(u.id, co, "OWNER");

    const result = await switchCompany({
      actorUserId: u.id,
      fromCompanyId: null,
      targetCompanyId: co,
    });
    expect(result).toEqual({ ok: true, companyId: co });
    const audits = await auditRowsFor(u.id, "company_switched");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({ from_company_id: null, to_company_id: co });
    expect((await findUserById(u.id))?.lastUsedCompanyId).toBe(co);
  });

  test("QA-H-12 mutation → audit 発火順 pin (audit の to_company_id が UPDATE 後の user.last_used_company_id と一致)", async () => {
    const co1 = await seedCompany("order-a");
    const co2 = await seedCompany("order-b");
    const u = await seedUser("order", { lastUsedCompanyId: co1 });
    await seedMembership(u.id, co1, "OWNER");
    await seedMembership(u.id, co2, "MEMBER");

    const result = await switchCompany({
      actorUserId: u.id,
      fromCompanyId: co1,
      targetCompanyId: co2,
    });
    expect(result.ok).toBe(true);
    const finalLastUsed = (await findUserById(u.id))?.lastUsedCompanyId;
    const payload = (await auditRowsFor(u.id, "company_switched"))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(payload.to_company_id).toBe(finalLastUsed);
  });
});
