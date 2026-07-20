import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { findInvitationById } from "@/db/repositories/invitation";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { revokeInvitation } from "../revoke";

// invitation/revoke use-case (src/invitation/revoke.ts) の DB 統合テスト。
// 正常 revoke / not_found_or_not_pending + audit 非発火 を検証。
// 認可 (OWNER/ADMIN) は Guard 層 (requireMembership "ADMIN") の責務。

const P = "revinv-test-";
const { cleanup, seedUser, seedCompany, seedMembership, seedInvitation } = createSeedHelpers(P);

describe("revokeInvitation", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("正常 revoke → status=REVOKED / invitation_revoked audit 発火", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("ok");
    await seedMembership(owner.id, co, "OWNER");
    const inv = await seedInvitation({
      companyId: co,
      email: `${P}invitee@example.com`,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });

    const result = await revokeInvitation({
      actorUserId: owner.id,
      companyId: co,
      invitationId: inv.id,
    });
    expect(result).toEqual({ ok: true });
    const persisted = await findInvitationById(inv.id);
    expect(persisted?.status).toBe("REVOKED");

    const audits = await auditRowsFor(owner.id, "invitation_revoked");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      invitation_id: inv.id,
      company_id: co,
      revoked_by_user_id: owner.id,
    });
  });

  test("QA-E-11 存在しない invitationId → not_found_or_not_pending / audit 発火なし", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("nf");
    await seedMembership(owner.id, co, "OWNER");

    const result = await revokeInvitation({
      actorUserId: owner.id,
      companyId: co,
      invitationId: `${P}inv-nonexistent`,
    });
    expect(result).toEqual({ ok: false, reason: "not_found_or_not_pending" });
    expect((await auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
  });

  test("既に REVOKED / ACCEPTED の invitation を再 revoke → not_found_or_not_pending (状態遷移防御)", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("re");
    await seedMembership(owner.id, co, "OWNER");
    const inv = await seedInvitation({
      companyId: co,
      email: `${P}re-invitee@example.com`,
      role: "MEMBER",
      invitedByUserId: owner.id,
      status: "REVOKED",
    });

    const result = await revokeInvitation({
      actorUserId: owner.id,
      companyId: co,
      invitationId: inv.id,
    });
    expect(result).toEqual({ ok: false, reason: "not_found_or_not_pending" });
    expect((await auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
  });

  test("別 company の invitationId (companyId mismatch) → not_found_or_not_pending", async () => {
    const owner = await seedUser("owner");
    const co1 = await seedCompany("co1");
    const co2 = await seedCompany("co2");
    await seedMembership(owner.id, co1, "OWNER");
    await seedMembership(owner.id, co2, "OWNER");
    const inv = await seedInvitation({
      companyId: co1,
      email: `${P}mism-invitee@example.com`,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });

    // co2 で co1 の invitation を revoke しようとしても markInvitationRevoked が 0 件更新。
    const result = await revokeInvitation({
      actorUserId: owner.id,
      companyId: co2,
      invitationId: inv.id,
    });
    expect(result).toEqual({ ok: false, reason: "not_found_or_not_pending" });
    // 元の invitation は影響なし (PENDING のまま)。
    const persisted = await findInvitationById(inv.id);
    expect(persisted?.status).toBe("PENDING");
    expect((await auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
  });
});
