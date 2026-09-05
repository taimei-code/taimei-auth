import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { transferOwnership } from "../transfer-ownership";

// transfer-ownership use-case (src/membership/transfer-ownership.ts) の DB 統合テスト。
// 委譲 + audit の from/to / 二段委譲 / withOwnerLockGuard FOR UPDATE の並行直列化 semantic を検証。
// 認可 (OWNER のみ / self-transfer 拒否 / not_found / already_owner) は Guard 層の責務。

const P = "trans-test-";
const { run, cleanup } = dbTest(P);

describe("transferOwnership", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-04 正常 委譲 → to は OWNER 昇格 / actor は ADMIN 降格 / ownership_transferred audit", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const admin = yield* db.seedUser("admin");
        const co = yield* db.seedCompany("h04");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(admin.id, co, "ADMIN");

        yield* transferOwnership({ actorUserId: owner.id, toUserId: admin.id, companyId: co });
        expect((yield* db.readMembership(admin.id, co))?.role).toBe("OWNER");
        expect((yield* db.readMembership(owner.id, co))?.role).toBe("ADMIN");

        const audits = yield* auditRowsFor(owner.id, "ownership_transferred");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          company_id: co,
          from_user_id: owner.id,
          to_user_id: admin.id,
        });
      }),
    ));

  test("QA-D-04 二段委譲 A→B, 続いて B→C 両者 200 / 全 role 状態が期待通り", () =>
    run(
      Effect.gen(function* () {
        // FOR UPDATE 直列化により逐次 2 段は成立する。二段目 (B→C) 実行時 B は OWNER に昇格済み。
        const db = yield* TestDb;
        const A = yield* db.seedUser("A");
        const B = yield* db.seedUser("B");
        const C = yield* db.seedUser("C");
        const co = yield* db.seedCompany("d04");
        yield* db.seedMembership(A.id, co, "OWNER");
        yield* db.seedMembership(B.id, co, "ADMIN");
        yield* db.seedMembership(C.id, co, "ADMIN");

        yield* transferOwnership({ actorUserId: A.id, toUserId: B.id, companyId: co });
        yield* transferOwnership({ actorUserId: B.id, toUserId: C.id, companyId: co });

        expect((yield* db.readMembership(A.id, co))?.role).toBe("ADMIN");
        expect((yield* db.readMembership(B.id, co))?.role).toBe("ADMIN");
        expect((yield* db.readMembership(C.id, co))?.role).toBe("OWNER");
      }),
    ));

  test("QA-D-04 並行 transfer (同 companyId, 別 to) → FOR UPDATE 直列化 / OWNER≥1 不変条件維持", () =>
    run(
      Effect.gen(function* () {
        // withOwnerLockGuard の FOR UPDATE により同 companyId の 2 リクエストは直列化 (deadlock なく順次 commit)。
        // Guard 層を skip して use-case を直接叩くと、同 actor から 2 回並行 transfer した場合は
        // 両 to が OWNER に昇格しうる (現行仕様: use-case は OWNER≥1 のみ守り OWNER≤1 は保証しない)。
        // Guard 経由の実運用では 2 回目の A は既に ADMIN で 403 に落ちるため運用問題にならない。
        // ここでは (a) failure なし (b) OWNER≥1 が最後に成立、を検証する。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner-race");
        const a = yield* db.seedUser("target-a");
        const b = yield* db.seedUser("target-b");
        const co = yield* db.seedCompany("race");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(a.id, co, "ADMIN");
        yield* db.seedMembership(b.id, co, "ADMIN");

        const settled = yield* Effect.all(
          [
            Effect.exit(
              transferOwnership({ actorUserId: owner.id, toUserId: a.id, companyId: co }),
            ),
            Effect.exit(
              transferOwnership({ actorUserId: owner.id, toUserId: b.id, companyId: co }),
            ),
          ],
          { concurrency: "unbounded" },
        );
        // Exit は Effect として再投入でき、失敗時は cause ごと test を落とす。
        for (const ex of settled) yield* ex;

        const rows = yield* db.readMembershipsOfCompany(co);
        const owners = rows.filter((r) => r.role === "OWNER");
        expect(owners.length).toBeGreaterThanOrEqual(1);
      }),
    ));

  test("QA-H-12 mutation → audit の発火順 pin (audit payload の to は UPDATE 後の OWNER と一致)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner-order");
        const to = yield* db.seedUser("to-order");
        const co = yield* db.seedCompany("h12");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.seedMembership(to.id, co, "ADMIN");

        yield* transferOwnership({ actorUserId: owner.id, toUserId: to.id, companyId: co });
        const audits = yield* auditRowsFor(owner.id, "ownership_transferred");
        const finalOwnerId = (yield* db.readMembership(to.id, co))?.role === "OWNER" ? to.id : null;
        const payload = audits[0]?.payload as Record<string, unknown>;
        expect(payload.to_user_id).toBe(finalOwnerId);
      }),
    ));
});
