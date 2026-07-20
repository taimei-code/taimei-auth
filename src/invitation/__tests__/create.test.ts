import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "../../auth";
import { db } from "@/db/client";
import { findActivePendingInvitation } from "@/db/repositories/invitation";
import { auditLog, invitation as invitationTable } from "@/db/schema";
import {
  buildTestApp,
  cleanupTestData,
  restoreActor,
  seedCompany,
  seedInvitation,
  seedMembership,
  seedUser,
  stubActor,
  TEST_PREFIX,
} from "../../handlers/__tests__/helpers";
import { connectRedis, redis } from "../../redis";
import { createInvitation } from "../create";

// invitation/create use-case (src/invitation/create.ts) の DB 統合 + handler HTTP テスト。
// - reused 両方向 (rate consume 0 / 1 回) を Redis の invitation_rate:* キーで直接観測
// - rate 上限 429 (INVITATION_HOURLY_LIMIT_PER_COMPANY を跨いだ超過)
// - rate 上限中でも既存 PENDING への再送は reused=true (idempotency > rate 順序 pin)
// - handler HTTP 経路で magic-link (auth.api.signInMagicLink) が reused=false/true 両経路各 1 回
// 認可 (OWNER/ADMIN + canInviteRole) は Guard 層 (requireInvite) の責務。
// seed/cleanup は helpers.ts の default (TEST_PREFIX) を使う: handler HTTP テストが同 prefix を
// 前提にしており、cleanup も TEST_PREFIX を対象にしているため合わせる。

async function auditRows(userId: string, eventType: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}

async function invitationRowsByEmail(companyId: string, email: string) {
  return db
    .select()
    .from(invitationTable)
    .where(and(eq(invitationTable.companyId, companyId), eq(invitationTable.email, email)));
}

// invitation_rate:<companyId>:<hourBucket> の hit 数を返す。key 未生成なら 0。
// hour bucket をまたぐ現象は test 内では発生しないため decode の複雑さは避ける。
async function rateCount(companyId: string): Promise<number> {
  const keys = await redis.keys(`invitation_rate:${companyId}:*`);
  if (keys.length === 0) return 0;
  const vals = await Promise.all(keys.map((k) => redis.get(k)));
  return vals.reduce((acc, v) => acc + (v ? Number(v) : 0), 0);
}

// key を消して bucket を先入れ状態にする helper (rate 上限テストで手動 pre-set する場合に使う)。
async function clearRateKey(companyId: string): Promise<void> {
  const keys = await redis.keys(`invitation_rate:${companyId}:*`);
  if (keys.length) await redis.del(keys);
}

describe("createInvitation (use-case)", () => {
  beforeAll(async () => {
    await connectRedis();
  });
  beforeEach(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  test("QA-H-07 新規 email → 新規 invitation 作成 + rate 1 消費 + invitation_sent audit / reused=false", async () => {
    const owner = await seedUser("h07-owner");
    const co = await seedCompany("h07");
    await seedMembership(owner.id, co, "OWNER");
    await clearRateKey(co);
    const email = `${TEST_PREFIX}h07-invitee@example.com`;

    const before = await rateCount(co);
    const result = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    const after = await rateCount(co);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(false);
    expect(after - before).toBe(1);

    const rows = await invitationRowsByEmail(co, email);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("PENDING");

    const audits = await auditRows(owner.id, "invitation_sent");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toEqual({
      invitation_id: rows[0]?.id,
      company_id: co,
      invited_email: email,
      role: "MEMBER",
      invited_by_user_id: owner.id,
    });
  });

  test("QA-M-02 既存 PENDING 再送 → reused=true / rate 消費 0 / audit 発火なし", async () => {
    const owner = await seedUser("m02-owner");
    const co = await seedCompany("m02");
    await seedMembership(owner.id, co, "OWNER");
    const email = `${TEST_PREFIX}m02-invitee@example.com`;
    const existing = await seedInvitation({
      companyId: co,
      email,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    await clearRateKey(co);

    const before = await rateCount(co);
    const result = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    const after = await rateCount(co);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(true);
    expect(result.invitation.id).toBe(existing.id);
    expect(after - before).toBe(0);
    // reused 経路では invitation_sent audit を新たに emit しない (「新規招待ではないため」)。
    expect((await auditRows(owner.id, "invitation_sent")).length).toBe(0);
  });

  test("QA-E-02 rate 上限到達 → rate_limited Result / invitation 作成なし / audit 発火なし", async () => {
    const owner = await seedUser("e02-owner");
    const co = await seedCompany("e02");
    await seedMembership(owner.id, co, "OWNER");
    await clearRateKey(co);
    const email = `${TEST_PREFIX}e02-invitee@example.com`;

    // INVITATION_HOURLY_LIMIT_PER_COMPANY のデフォルトは 50。bucket に 50 hit を pre-set して超過状態を作る。
    const bucket = new Date().toISOString().slice(0, 13);
    await redis.set(`invitation_rate:${co}:${bucket}`, "50", { EX: 3600 });

    const result = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect((await invitationRowsByEmail(co, email)).length).toBe(0);
    expect((await auditRows(owner.id, "invitation_sent")).length).toBe(0);
  });

  test("QA-M-02 rate 上限中でも既存 PENDING 宛の再送 → reused=true (idempotency > rate 順序)", async () => {
    // 設計決定 3 の逐次 semantic: idempotency check (tx 外) → 新規のみ rate 消費 (tx 外) → tx。
    // idempotency check が rate 消費より先にあるため、既存 PENDING があれば rate 上限でも 200 reused。
    const owner = await seedUser("m02b-owner");
    const co = await seedCompany("m02b");
    await seedMembership(owner.id, co, "OWNER");
    const email = `${TEST_PREFIX}m02b-invitee@example.com`;
    const existing = await seedInvitation({
      companyId: co,
      email,
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    await clearRateKey(co);
    const bucket = new Date().toISOString().slice(0, 13);
    await redis.set(`invitation_rate:${co}:${bucket}`, "999", { EX: 3600 });

    const result = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(true);
    expect(result.invitation.id).toBe(existing.id);
  });

  test("QA-H-13 idempotency は逐次 (先行 commit 後の後続) — 2 回目は既存を拾い rate 消費なし", async () => {
    const owner = await seedUser("h13-owner");
    const co = await seedCompany("h13");
    await seedMembership(owner.id, co, "OWNER");
    await clearRateKey(co);
    const email = `${TEST_PREFIX}h13-invitee@example.com`;

    const before = await rateCount(co);
    const first = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reused).toBe(false);
    const afterFirst = await rateCount(co);
    expect(afterFirst - before).toBe(1);

    const second = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "MEMBER",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.invitation.id).toBe(first.invitation.id);
    // 2 回目は rate 消費しない (「新規招待のみ」)。
    const afterSecond = await rateCount(co);
    expect(afterSecond - afterFirst).toBe(0);
    // PENDING は 1 行のまま (unique index はないが逐次 semantic により重複しない)。
    const rows = await invitationRowsByEmail(co, email);
    expect(rows.length).toBe(1);
  });

  test("QA-H-12 mutation → audit の発火順 pin (audit の invitation_id が返却 row と一致)", async () => {
    const owner = await seedUser("h12-owner");
    const co = await seedCompany("h12");
    await seedMembership(owner.id, co, "OWNER");
    await clearRateKey(co);
    const email = `${TEST_PREFIX}h12-invitee@example.com`;

    const result = await createInvitation({
      actorUserId: owner.id,
      companyId: co,
      email,
      role: "ADMIN",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const persisted = await findActivePendingInvitation(co, email);
    const audit = (await auditRows(owner.id, "invitation_sent"))[0];
    const payload = audit?.payload as Record<string, unknown>;
    expect(payload.invitation_id).toBe(persisted?.id);
    expect(payload.invitation_id).toBe(result.invitation.id);
  });
});

describe("POST /api/account/companies/:companyId/invitations (handler)", () => {
  beforeAll(async () => {
    await connectRedis();
  });
  beforeEach(async () => {
    restoreActor();
    await cleanupTestData();
  });
  afterAll(async () => {
    restoreActor();
    await cleanupTestData();
  });

  test("magic-link は handler post-commit で reused=false 経路 1 回だけ呼ばれる", async () => {
    const owner = await seedUser("ml-new-owner");
    const co = await seedCompany("ml-new");
    await seedMembership(owner.id, co, "OWNER");
    stubActor(owner);
    const email = `${TEST_PREFIX}ml-new-invitee@example.com`;

    const spy = spyOn(auth.api, "signInMagicLink");
    try {
      const app = buildTestApp();
      const res = await app.request(`http://localhost/api/account/companies/${co}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role: "MEMBER" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reused: boolean };
      expect(body.reused).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("magic-link は reused=true 経路 (既存 PENDING 再送) でも 1 回だけ呼ばれる (両経路で送信)", async () => {
    const owner = await seedUser("ml-reuse-owner");
    const co = await seedCompany("ml-reuse");
    await seedMembership(owner.id, co, "OWNER");
    const email = `${TEST_PREFIX}ml-reuse-invitee@example.com`;
    await seedInvitation({ companyId: co, email, role: "MEMBER", invitedByUserId: owner.id });
    stubActor(owner);

    const spy = spyOn(auth.api, "signInMagicLink");
    try {
      const app = buildTestApp();
      const res = await app.request(`http://localhost/api/account/companies/${co}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role: "MEMBER" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reused: boolean };
      expect(body.reused).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
