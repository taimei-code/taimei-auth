import { afterAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { auth } from "../../auth";
import {
  buildTestApp,
  requestApp,
  responseJson,
  restoreActor,
  stubActor,
  TEST_PREFIX,
} from "../../handlers/__tests__/helpers";
import { dbTest, drained, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { getRedis } from "../../redis";
import { createInvitation } from "../create";
import { RateLimited } from "../errors";

// invitation/create use-case (src/invitation/create.ts) の DB 統合 + handler HTTP テスト。
// - reused 両方向 (rate consume 0 / 1 回) を Redis の invitation_rate:* キーで直接観測
// - rate 上限 429 (INVITATION_HOURLY_LIMIT_PER_COMPANY を跨いだ超過)
// - rate 上限中でも既存 PENDING への再送は reused=true (idempotency > rate 順序 pin)
// - handler HTTP 経路で magic-link (auth.api.signInMagicLink) が reused=false/true 両経路各 1 回
// 認可 (OWNER/ADMIN + canInviteRole) は Guard 層 (requireInvite) の責務。
// seed/cleanup は TEST_PREFIX を使う: handler HTTP テストが同 prefix を前提にしているため合わせる。

const { run, cleanup } = dbTest(TEST_PREFIX);

const invitationRowsByEmail = (companyId: string, email: string) =>
  TestDb.use((db) => db.readInvitationsByEmail(companyId, email));

const redis = () => Effect.promise(() => getRedis());

// invitation_rate:<companyId>:<hourBucket> の hit 数を返す。key 未生成なら 0。
// hour bucket をまたぐ現象は test 内では発生しないため decode の複雑さは避ける。
const rateCount = (companyId: string) =>
  Effect.gen(function* () {
    const r = yield* redis();
    const keys = yield* Effect.promise(() => r.keys(`invitation_rate:${companyId}:*`));
    const vals = yield* Effect.forEach(keys, (k) => Effect.promise(() => r.get(k)), {
      concurrency: "unbounded",
    });
    return vals.reduce((acc, v) => acc + (v ? Number(v) : 0), 0);
  });

// key を消して bucket を先入れ状態にする helper (rate 上限テストで手動 pre-set する場合に使う)。
const clearRateKey = (companyId: string) =>
  Effect.promise(async () => {
    const r = await getRedis();
    const keys = await r.keys(`invitation_rate:${companyId}:*`);
    if (keys.length) await r.del(keys);
  });

const presetRate = (companyId: string, value: string) =>
  redis().pipe(
    Effect.flatMap((r) =>
      Effect.promise(() =>
        r.set(`invitation_rate:${companyId}:${new Date().toISOString().slice(0, 13)}`, value, {
          EX: 3600,
        }),
      ),
    ),
  );

describe("createInvitation (use-case)", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-07 新規 email → 新規 invitation 作成 + rate 1 消費 + invitation_sent audit / reused=false", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h07-owner");
        const co = yield* db.seedCompany("h07");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h07-invitee@example.com`;

        const before = yield* rateCount(co);
        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        const after = yield* rateCount(co);

        expect(result.reused).toBe(false);
        expect(after - before).toBe(1);

        const rows = yield* invitationRowsByEmail(co, email);
        expect(rows.length).toBe(1);
        expect(rows[0]?.status).toBe("PENDING");

        const audits = yield* auditRowsFor(owner.id, "invitation_sent");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          invitation_id: rows[0]?.id,
          company_id: co,
          invited_email: email,
          role: "MEMBER",
          invited_by_user_id: owner.id,
        });
      }),
    ));

  test("QA-M-02 既存 PENDING 再送 → reused=true / rate 消費 0 / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m02-owner");
        const co = yield* db.seedCompany("m02");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}m02-invitee@example.com`;
        const existing = yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        yield* clearRateKey(co);

        const before = yield* rateCount(co);
        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        const after = yield* rateCount(co);

        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
        expect(after - before).toBe(0);
        // reused 経路では invitation_sent audit を新たに emit しない (「新規招待ではないため」)。
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("QA-E-02 rate 上限到達 → rate_limited Result / invitation 作成なし / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("e02-owner");
        const co = yield* db.seedCompany("e02");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}e02-invitee@example.com`;

        // INVITATION_HOURLY_LIMIT_PER_COMPANY のデフォルトは 50。bucket に 50 hit を pre-set して超過状態を作る。
        yield* presetRate(co, "50");

        const e = yield* Effect.flip(
          createInvitation({ actorUserId: owner.id, companyId: co, email, role: "MEMBER" }),
        );
        expectFailure(e, RateLimited, "rate_limited", 429);
        expect((yield* invitationRowsByEmail(co, email)).length).toBe(0);
        expect((yield* auditRowsFor(owner.id, "invitation_sent")).length).toBe(0);
      }),
    ));

  test("QA-M-02 rate 上限中でも既存 PENDING 宛の再送 → reused=true (idempotency > rate 順序)", () =>
    run(
      Effect.gen(function* () {
        // 逐次 semantic: idempotency check (tx 外) → 新規のみ rate 消費 (tx 外) → tx。
        // idempotency check が rate 消費より先にあるため、既存 PENDING があれば rate 上限でも 200 reused。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m02b-owner");
        const co = yield* db.seedCompany("m02b");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}m02b-invitee@example.com`;
        const existing = yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        yield* clearRateKey(co);
        yield* presetRate(co, "999");

        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(result.reused).toBe(true);
        expect(result.invitation.id).toBe(existing.id);
      }),
    ));

  test("QA-H-13 idempotency は逐次 (先行 commit 後の後続) — 2 回目は既存を拾い rate 消費なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h13-owner");
        const co = yield* db.seedCompany("h13");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h13-invitee@example.com`;

        const before = yield* rateCount(co);
        const first = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(first.reused).toBe(false);
        const afterFirst = yield* rateCount(co);
        expect(afterFirst - before).toBe(1);

        const second = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "MEMBER",
        });
        expect(second.reused).toBe(true);
        expect(second.invitation.id).toBe(first.invitation.id);
        // 2 回目は rate 消費しない (「新規招待のみ」)。
        const afterSecond = yield* rateCount(co);
        expect(afterSecond - afterFirst).toBe(0);
        // PENDING は 1 行のまま (unique index はないが逐次 semantic により重複しない)。
        const rows = yield* invitationRowsByEmail(co, email);
        expect(rows.length).toBe(1);
      }),
    ));

  test("QA-H-12 mutation → audit の発火順 pin (audit の invitation_id が返却 row と一致)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("h12-owner");
        const co = yield* db.seedCompany("h12");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* clearRateKey(co);
        const email = `${TEST_PREFIX}h12-invitee@example.com`;

        const result = yield* createInvitation({
          actorUserId: owner.id,
          companyId: co,
          email,
          role: "ADMIN",
        });
        const persisted = yield* db.readPendingInvitation(co, email);
        const audit = (yield* auditRowsFor(owner.id, "invitation_sent"))[0];
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.invitation_id).toBe(persisted?.id);
        expect(payload.invitation_id).toBe(result.invitation.id);
      }),
    ));
});

// magic-link 送信の spy。restore は Effect の release で必ず行う。
const withMagicLinkSpy = <A, E, R>(
  use: (spy: Mock<typeof auth.api.signInMagicLink>) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => spyOn(auth.api, "signInMagicLink")),
    use,
    (spy) => Effect.sync(() => spy.mockRestore()),
  );

describe("POST /api/account/companies/:companyId/invitations (handler)", () => {
  beforeEach(() => {
    restoreActor();
    return cleanup();
  });
  afterAll(() => {
    restoreActor();
    return cleanup();
  });

  test("magic-link は handler post-commit で reused=false 経路 1 回だけ呼ばれる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("ml-new-owner");
        const co = yield* db.seedCompany("ml-new");
        yield* db.seedMembership(owner.id, co, "OWNER");
        stubActor(owner);
        const email = `${TEST_PREFIX}ml-new-invitee@example.com`;

        yield* withMagicLinkSpy((spy) =>
          Effect.gen(function* () {
            const app = buildTestApp();
            const res = yield* drained(
              requestApp(app, `http://localhost/api/account/companies/${co}/invitations`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, role: "MEMBER" }),
              }),
            );
            expect(res.status).toBe(200);
            const body = (yield* responseJson(res)) as { reused: boolean };
            expect(body.reused).toBe(false);
            expect(spy).toHaveBeenCalledTimes(1);
          }),
        );
      }),
    ));

  test("magic-link は reused=true 経路 (既存 PENDING 再送) でも 1 回だけ呼ばれる (両経路で送信)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("ml-reuse-owner");
        const co = yield* db.seedCompany("ml-reuse");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const email = `${TEST_PREFIX}ml-reuse-invitee@example.com`;
        yield* db.seedInvitation({
          companyId: co,
          email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        stubActor(owner);

        yield* withMagicLinkSpy((spy) =>
          Effect.gen(function* () {
            const app = buildTestApp();
            const res = yield* drained(
              requestApp(app, `http://localhost/api/account/companies/${co}/invitations`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, role: "MEMBER" }),
              }),
            );
            expect(res.status).toBe(200);
            const body = (yield* responseJson(res)) as { reused: boolean };
            expect(body.reused).toBe(true);
            expect(spy).toHaveBeenCalledTimes(1);
          }),
        );
      }),
    ));
});
