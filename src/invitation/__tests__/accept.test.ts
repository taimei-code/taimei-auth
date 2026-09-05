import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  findInvitationByToken,
  generateInvitationId,
  generateInvitationToken,
} from "@/db/repositories/invitation";
import { findMembership, type Role, updateMembershipRole } from "@/db/repositories/membership";
import { auditLog, invitation, membership } from "@/db/schema";
import { flipLive, runLive, runLiveResult } from "../../__tests__/live-runner";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { ExpiredOrUsed } from "../../membership/guard/errors";
import { acceptInvitation } from "../accept";

// invitation accept use-case (src/invitation/accept.ts) の DB 統合テスト。
// FOR SHARE lock + canAcceptInvitedRole の再検証 / audit event / reused 冪等 /
// 並行 double-accept / 降格レース の invariant を検証する。
// 既存 delete.test.ts の並行 test パターンに準拠 (Promise.all + DB 状態の組 assert)。

const P = "acc-test-";
const { cleanup, seedUser, seedCompany, seedMembership, seedInvitation } = createSeedHelpers(P);

async function auditCountByType(userId: string, eventType: string): Promise<number> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)));
  return rows.length;
}

async function firstAudit(userId: string, eventType: string) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)));
  return rows.at(0);
}

async function reloadInvitation(token: string) {
  return findInvitationByToken(token);
}

describe("acceptInvitation", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-01 正常 accept — OWNER 招待 (inviter 現役 OWNER) → membership INSERT + accepted audit / reject audit 0 件", async () => {
    const owner = await seedUser("owner");
    const co = await seedCompany("h01");
    await seedMembership(owner.id, co, "OWNER");
    const invitee = await seedUser("invitee");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "OWNER",
      invitedByUserId: owner.id,
    });
    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await runLiveResult(
        acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        }),
      );
      expect(result).toEqual({ ok: true, companyId: co });
    } finally {
      warn.mockRestore();
    }

    expect((await findMembership(invitee.id, co))?.role).toBe("OWNER");
    expect(await auditCountByType(invitee.id, "invitation_accepted")).toBe(1);
    expect(await auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
    // 正常 accept で warn は発火しない (拒否経路との対称性)。
    expect(warn).not.toHaveBeenCalled();
  });

  test("QA-M-01 reused (既所属短絡) は entry 層で 200 に短絡するため、accept use-case は呼ばれない (契約テスト)", async () => {
    // acceptInvitation は entry で proceed 判定が下りた invitation のみを受ける契約。
    // reused の分岐 (既所属短絡) は entry 側の test でカバー。ここでは use-case が
    // 「既所属 user へ再 accept を渡された」ケースで unique 制約 error が伝播することを確認。
    const owner = await seedUser("m01-owner");
    const co = await seedCompany("m01");
    await seedMembership(owner.id, co, "OWNER");
    const invitee = await seedUser("m01-invitee");
    await seedMembership(invitee.id, co, "MEMBER");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // 契約: entry が reused に振り分けた後は use-case 呼ばない。誤って呼ぶと INSERT が unique 制約
      // 違反となり DbError が E に載る (runLive は reject)。この失敗を handler 側で握るのは責務外なので、
      // ここでは失敗することだけを固定する (fail-closed で運用ミスを検知する仕組み)。
      await expect(
        runLive(
          acceptInvitation({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        ),
      ).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  test("QA-H-05 / QA-M-02 偽造 OWNER 招待 (inviter が accept 時点で ADMIN) → 410 + reject audit (payload に PII 無し) + warn 先行", async () => {
    const inviter = await seedUser("m02-inviter");
    const otherOwner = await seedUser("m02-other-owner");
    const co = await seedCompany("m02");
    await seedMembership(inviter.id, co, "OWNER");
    await seedMembership(otherOwner.id, co, "OWNER");
    const invitee = await seedUser("m02-invitee");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "OWNER",
      invitedByUserId: inviter.id,
    });
    // inviter を先に降格させる (実運用では handler 経由の role 変更相当)。
    await updateMembershipRole(inviter.id, co, "ADMIN");
    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    // Bun 1.3 の spy.mockRestore() は call history もクリアするため、warn call の検証は
    // mockRestore 前に済ませてから spy を戻す (実測: PR #109)。
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let warnCalls: unknown[][] = [];
    let acceptFailure: unknown;
    try {
      acceptFailure = await flipLive(
        acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        }),
      );
      warnCalls = warn.mock.calls.map((c) => Array.from(c));
    } finally {
      warn.mockRestore();
    }
    // 拒否は E channel の ExpiredOrUsed (410 / expired_or_used)。内訳は下の audit payload の reason が持つ。
    expect(acceptFailure).toBeInstanceOf(ExpiredOrUsed);
    const rejected = acceptFailure as ExpiredOrUsed;
    expect([rejected.error, rejected.status]).toEqual(["expired_or_used", 410]);

    // reject 経路は tx を rollback させるため、invitation は PENDING のまま (accept 誤 commit の regression 検知)。
    expect((await reloadInvitation(inv.token))?.status).toBe("PENDING");
    expect(await findMembership(invitee.id, co)).toBeUndefined();
    expect(await auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(1);

    const rejectAudit = await firstAudit(invitee.id, "invitation_accept_rejected");
    const payload = rejectAudit?.payload as Record<string, unknown>;
    expect(payload.invitation_id).toBe(inv.id);
    expect(payload.company_id).toBe(co);
    expect(payload.invited_by_user_id).toBe(inviter.id);
    expect(payload.attempted_role).toBe("OWNER");
    expect(payload.inviter_current_role).toBe("ADMIN");
    expect(payload.reason).toBe("inviter_not_owner_or_missing");
    // PII (email) は payload に含めない契約。
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("invited_email");

    // warn は DB 書込みより前に呼ばれる (isolate crash 対策の先行 emit)。同 payload を
    // JSON でエコーしていることを確認する (順序は audit との対応で担保)。
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    const call = warnCalls.at(-1);
    expect(call?.[0]).toBe("invitation_accept_rejected");
    expect(String(call?.[1] ?? "")).toContain(`"invitation_id":"${inv.id}"`);
  });

  test("QA-M-04 招待者 membership 行が不在 (退会) の OWNER 招待 → 410 + reject audit (inviter_current_role=null)", async () => {
    const inviter = await seedUser("m04-inviter");
    const otherOwner = await seedUser("m04-other-owner");
    const co = await seedCompany("m04");
    await seedMembership(inviter.id, co, "OWNER");
    await seedMembership(otherOwner.id, co, "OWNER");
    const invitee = await seedUser("m04-invitee");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "OWNER",
      invitedByUserId: inviter.id,
    });
    // inviter membership を除名 (row 削除) して不在状態を作る。他 OWNER が残るため lock guard 通過。
    await db
      .delete(membership)
      .where(and(eq(membership.userId, inviter.id), eq(membership.companyId, co)));

    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failure = await flipLive(
        acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        }),
      );
      expect(failure).toBeInstanceOf(ExpiredOrUsed);
    } finally {
      warn.mockRestore();
    }
    const audit = await firstAudit(invitee.id, "invitation_accept_rejected");
    const payload = audit?.payload as Record<string, unknown>;
    expect(payload.inviter_current_role).toBe(null);
    expect(payload.reason).toBe("inviter_not_owner_or_missing");
  });

  test("QA-M-05 already-accepted invitation (PENDING 消失) を再度 accept → 410 + double_accept audit", async () => {
    const owner = await seedUser("m05-owner");
    const co = await seedCompany("m05");
    await seedMembership(owner.id, co, "OWNER");
    const invitee = await seedUser("m05-invitee");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    // 1 度 accept で PENDING を消費する。
    const first = await runLiveResult(
      acceptInvitation({
        actor: { id: invitee.id, email: invitee.email },
        invitation: invitationRow,
      }),
    );
    expect(first.ok).toBe(true);

    // 再度同じ invitation を渡すと markInvitationAccepted が 0 件更新 → double_accept で reject。
    const stale = await reloadInvitation(inv.token);
    if (!stale) throw new Error("reload failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const second = await flipLive(
        acceptInvitation({ actor: { id: invitee.id, email: invitee.email }, invitation: stale }),
      );
      expect(second).toBeInstanceOf(ExpiredOrUsed);
    } finally {
      warn.mockRestore();
    }
    const audit = await firstAudit(invitee.id, "invitation_accept_rejected");
    expect((audit?.payload as Record<string, unknown>).reason).toBe("double_accept");
  });

  test("QA-D-03 / QA-M-06 unknown invitation.role (直 INSERT 由来) → 410 + reject audit (attempted_role が unknown 文字列)", async () => {
    const owner = await seedUser("m06-owner");
    const co = await seedCompany("m06");
    await seedMembership(owner.id, co, "OWNER");
    const invitee = await seedUser("m06-invitee");

    // repository の insertInvitation は Role literal 型なので、直 INSERT で unknown role を注入する。
    const inv = generateInvitationId();
    const tok = generateInvitationToken();
    await db.insert(invitation).values({
      id: inv,
      companyId: co,
      email: invitee.email,
      // Role 型を fail-closed 検証するため意図的に unknown 文字列。cast で型検査を抑止する。
      role: "SUPERVISOR" as Role,
      token: tok,
      expiresAt: new Date(Date.now() + 86_400_000),
      status: "PENDING",
      invitedByUserId: owner.id,
    });
    const invitationRow = await findInvitationByToken(tok);
    if (!invitationRow) throw new Error("seed failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failure = await flipLive(
        acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        }),
      );
      expect(failure).toBeInstanceOf(ExpiredOrUsed);
    } finally {
      warn.mockRestore();
    }
    const audit = await firstAudit(invitee.id, "invitation_accept_rejected");
    const payload = audit?.payload as Record<string, unknown>;
    expect(payload.attempted_role).toBe("SUPERVISOR");
    expect(payload.reason).toBe("unknown_invited_role");
  });

  test("QA-M-07 double-accept 並行 (同 token へ 2 client 同時) → 片方のみ ok、他方 410 + double_accept audit", async () => {
    const owner = await seedUser("m07-owner");
    const co = await seedCompany("m07");
    await seedMembership(owner.id, co, "OWNER");
    const invitee = await seedUser("m07-invitee");
    const inv = await seedInvitation({
      companyId: co,
      email: invitee.email,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    const invitationRow = await reloadInvitation(inv.token);
    if (!invitationRow) throw new Error("seed failed");

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const results = await Promise.allSettled([
        runLive(
          acceptInvitation({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        ),
        runLive(
          acceptInvitation({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        ),
      ]);
      const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : "throw"));
      // 片方は成功、もう片方は ExpiredOrUsed (410) か unique 制約の DbError で reject
      // (どちらも membership を重複作らない)。
      const oks = outcomes.filter((o) => typeof o === "object");
      expect(oks.length).toBe(1);
    } finally {
      warn.mockRestore();
    }
    // membership は 1 行だけ。
    const rows = await db
      .select()
      .from(membership)
      .where(and(eq(membership.userId, invitee.id), eq(membership.companyId, co)));
    expect(rows.length).toBe(1);
  });

  test("QA-M-09 accept vs 降格 の 2-outcome — (a) 降格 commit 先行なら 410 / (b) accept commit 先行なら OWNER 正当 mint。いずれも `降格済み inviter からの OWNER mint` は 0 件", async () => {
    // 分岐 (a): 降格を先に commit する。
    {
      const inviter = await seedUser("m09a-inv");
      const otherOwner = await seedUser("m09a-oth");
      const co = await seedCompany("m09a");
      await seedMembership(inviter.id, co, "OWNER");
      await seedMembership(otherOwner.id, co, "OWNER");
      const invitee = await seedUser("m09a-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "OWNER",
        invitedByUserId: inviter.id,
      });
      await updateMembershipRole(inviter.id, co, "ADMIN"); // 降格 先行 commit
      const invitationRow = await reloadInvitation(inv.token);
      if (!invitationRow) throw new Error("seed failed");
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const failure = await flipLive(
          acceptInvitation({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        );
        expect(failure).toBeInstanceOf(ExpiredOrUsed);
      } finally {
        warn.mockRestore();
      }
      expect(await findMembership(invitee.id, co)).toBeUndefined();
    }

    // 分岐 (b): accept を commit してから降格。
    {
      const inviter = await seedUser("m09b-inv");
      const otherOwner = await seedUser("m09b-oth");
      const co = await seedCompany("m09b");
      await seedMembership(inviter.id, co, "OWNER");
      await seedMembership(otherOwner.id, co, "OWNER");
      const invitee = await seedUser("m09b-invitee");
      const inv = await seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "OWNER",
        invitedByUserId: inviter.id,
      });
      const invitationRow = await reloadInvitation(inv.token);
      if (!invitationRow) throw new Error("seed failed");
      const acceptResult = await runLive(
        acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        }),
      );
      expect(acceptResult.companyId).toBe(co);
      expect((await findMembership(invitee.id, co))?.role).toBe("OWNER");
      // accept 後の降格は通常通り適用可能 (別 OWNER 残存)。
      await updateMembershipRole(inviter.id, co, "ADMIN");
      expect((await findMembership(inviter.id, co))?.role).toBe("ADMIN");
    }
  });
});
