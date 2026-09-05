import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { NotFoundOrNotPending } from "../errors";
import { revokeInvitation } from "../revoke";

// invitation/revoke use-case (src/invitation/revoke.ts) の DB 統合テスト。
// 正常 revoke / not_found_or_not_pending + audit 非発火 を検証。
// 認可 (OWNER/ADMIN) は Guard 層 (requireMembership "ADMIN") の責務。

const P = "revinv-test-";
const { run, cleanup } = dbTest(P);

describe("revokeInvitation", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("正常 revoke → status=REVOKED / invitation_revoked audit 発火", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("ok");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: `${P}invitee@example.com`,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });

        yield* revokeInvitation({ actorUserId: owner.id, companyId: co, invitationId: inv.id });
        const persisted = yield* db.readInvitation(inv.id);
        expect(persisted?.status).toBe("REVOKED");

        const audits = yield* auditRowsFor(owner.id, "invitation_revoked");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          invitation_id: inv.id,
          company_id: co,
          revoked_by_user_id: owner.id,
        });
      }),
    ));

  test("QA-E-11 存在しない invitationId → not_found_or_not_pending / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("nf");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const e = yield* Effect.flip(
          revokeInvitation({
            actorUserId: owner.id,
            companyId: co,
            invitationId: `${P}inv-nonexistent`,
          }),
        );
        expectFailure(e, NotFoundOrNotPending, "not_found_or_not_pending", 404);
        expect((yield* auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
      }),
    ));

  test("既に REVOKED / ACCEPTED の invitation を再 revoke → not_found_or_not_pending (状態遷移防御)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("re");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: `${P}re-invitee@example.com`,
          role: "MEMBER",
          invitedByUserId: owner.id,
          status: "REVOKED",
        });

        const e = yield* Effect.flip(
          revokeInvitation({ actorUserId: owner.id, companyId: co, invitationId: inv.id }),
        );
        expectFailure(e, NotFoundOrNotPending, "not_found_or_not_pending", 404);
        expect((yield* auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
      }),
    ));

  test("別 company の invitationId (companyId mismatch) → not_found_or_not_pending", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co1 = yield* db.seedCompany("co1");
        const co2 = yield* db.seedCompany("co2");
        yield* db.seedMembership(owner.id, co1, "OWNER");
        yield* db.seedMembership(owner.id, co2, "OWNER");
        const inv = yield* db.seedInvitation({
          companyId: co1,
          email: `${P}mism-invitee@example.com`,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });

        // co2 で co1 の invitation を revoke しようとしても markInvitationRevoked が 0 件更新。
        const e = yield* Effect.flip(
          revokeInvitation({ actorUserId: owner.id, companyId: co2, invitationId: inv.id }),
        );
        expectFailure(e, NotFoundOrNotPending, "not_found_or_not_pending", 404);
        // 元の invitation は影響なし (PENDING のまま)。
        const persisted = yield* db.readInvitation(inv.id);
        expect(persisted?.status).toBe("PENDING");
        expect((yield* auditRowsFor(owner.id, "invitation_revoked")).length).toBe(0);
      }),
    ));
});
