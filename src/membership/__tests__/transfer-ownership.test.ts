import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findMembership } from "@/db/repositories/membership";
import { membership } from "@/db/schema";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { transferOwnership } from "../transfer-ownership";

// transfer-ownership use-case (src/membership/transfer-ownership.ts) の DB 統合テスト。
// 委譲 + audit の from/to / 二段委譲 / withOwnerLockGuard FOR UPDATE の並行直列化 semantic を検証。
// 認可 (OWNER のみ / self-transfer 拒否 / not_found / already_owner) は Guard 層の責務。

const P = "trans-test-";
const { cleanup, seedUser, seedCompany, seedMembership } = createSeedHelpers(P);

describe("transferOwnership", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-04 正常 委譲 → to は OWNER 昇格 / actor は ADMIN 降格 / ownership_transferred audit", async () => {
    const owner = await seedUser("owner");
    const admin = await seedUser("admin");
    const co = await seedCompany("h04");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(admin.id, co, "ADMIN");

    const result = await transferOwnership({
      actorUserId: owner.id,
      toUserId: admin.id,
      companyId: co,
    });
    expect(result).toEqual({ ok: true });
    expect((await findMembership(admin.id, co))?.role).toBe("OWNER");
    expect((await findMembership(owner.id, co))?.role).toBe("ADMIN");

    const audits = await auditRowsFor(owner.id, "ownership_transferred");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      company_id: co,
      from_user_id: owner.id,
      to_user_id: admin.id,
    });
  });

  test("QA-D-04 二段委譲 A→B, 続いて B→C 両者 200 / 全 role 状態が期待通り", async () => {
    // FOR UPDATE 直列化により逐次 2 段は成立する。二段目 (B→C) 実行時 B は OWNER に昇格済み。
    const A = await seedUser("A");
    const B = await seedUser("B");
    const C = await seedUser("C");
    const co = await seedCompany("d04");
    await seedMembership(A.id, co, "OWNER");
    await seedMembership(B.id, co, "ADMIN");
    await seedMembership(C.id, co, "ADMIN");

    const first = await transferOwnership({
      actorUserId: A.id,
      toUserId: B.id,
      companyId: co,
    });
    expect(first).toEqual({ ok: true });

    const second = await transferOwnership({
      actorUserId: B.id,
      toUserId: C.id,
      companyId: co,
    });
    expect(second).toEqual({ ok: true });

    expect((await findMembership(A.id, co))?.role).toBe("ADMIN");
    expect((await findMembership(B.id, co))?.role).toBe("ADMIN");
    expect((await findMembership(C.id, co))?.role).toBe("OWNER");
  });

  test("QA-D-04 並行 transfer (同 companyId, 別 to) → FOR UPDATE 直列化 / OWNER≥1 不変条件維持", async () => {
    // withOwnerLockGuard の FOR UPDATE により同 companyId の 2 リクエストは直列化 (deadlock なく順次 commit)。
    // Guard 層を skip して use-case を直接叩くと、同 actor から 2 回並行 transfer した場合は
    // 両 to が OWNER に昇格しうる (現行仕様: use-case は OWNER≥1 のみ守り OWNER≤1 は保証しない)。
    // Guard 経由の実運用では 2 回目の A は既に ADMIN で 403 に落ちるため運用問題にならない。
    // ここでは (a) throw なし (b) OWNER≥1 が最後に成立、を検証する。
    const owner = await seedUser("owner-race");
    const a = await seedUser("target-a");
    const b = await seedUser("target-b");
    const co = await seedCompany("race");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(a.id, co, "ADMIN");
    await seedMembership(b.id, co, "ADMIN");

    const settled = await Promise.allSettled([
      transferOwnership({ actorUserId: owner.id, toUserId: a.id, companyId: co }),
      transferOwnership({ actorUserId: owner.id, toUserId: b.id, companyId: co }),
    ]);
    for (const s of settled) {
      if (s.status === "rejected") throw s.reason;
      expect(s.value.ok).toBe(true);
    }

    const rows = await db.select().from(membership).where(eq(membership.companyId, co));
    const owners = rows.filter((r) => r.role === "OWNER");
    expect(owners.length).toBeGreaterThanOrEqual(1);
  });

  test("QA-H-12 mutation → audit の発火順 pin (audit payload の to は UPDATE 後の OWNER と一致)", async () => {
    const owner = await seedUser("owner-order");
    const to = await seedUser("to-order");
    const co = await seedCompany("h12");
    await seedMembership(owner.id, co, "OWNER");
    await seedMembership(to.id, co, "ADMIN");

    const result = await transferOwnership({
      actorUserId: owner.id,
      toUserId: to.id,
      companyId: co,
    });
    expect(result.ok).toBe(true);
    const audits = await auditRowsFor(owner.id, "ownership_transferred");
    const finalOwnerId = (await findMembership(to.id, co))?.role === "OWNER" ? to.id : null;
    const payload = audits[0]?.payload as Record<string, unknown>;
    expect(payload.to_user_id).toBe(finalOwnerId);
  });
});
