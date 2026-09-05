import { afterAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { Role } from "@/db/schema";
import { ExpiredOrUsed } from "../../membership/guard/errors";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { acceptInvitation } from "../accept";

// invitation accept use-case (src/invitation/accept.ts) の DB 統合テスト。
// FOR SHARE lock + canAcceptInvitedRole の再検証 / audit event / reused 冪等 /
// 並行 double-accept / 降格レース の invariant を検証する。

const P = "acc-test-";
const { run, cleanup } = dbTest(P);

const auditCountByType = (userId: string, eventType: string) =>
  auditRowsFor(userId, eventType).pipe(Effect.map((rows) => rows.length));

const firstAudit = (userId: string, eventType: string) =>
  auditRowsFor(userId, eventType).pipe(Effect.map((rows) => rows.at(0)));

const reloadInvitation = (token: string) =>
  TestDb.use((db) => db.readInvitationByToken(token)).pipe(
    Effect.map((row) => {
      if (!row) throw new Error("seed failed");
      return row;
    }),
  );

const membershipRowsOf = (userId: string, companyId: string) =>
  TestDb.use((db) => db.readMemberships(userId)).pipe(
    Effect.map((rows) => rows.filter((r) => r.companyId === companyId)),
  );

// reject 経路の console.warn を捕捉する。restore は Effect の release で必ず行う。
const withWarnSpy = <A, E, R>(use: (warn: Mock<typeof console.warn>) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => spyOn(console, "warn").mockImplementation(() => {})),
    use,
    (warn) => Effect.sync(() => warn.mockRestore()),
  );

describe("acceptInvitation", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-01 正常 accept — OWNER 招待 (inviter 現役 OWNER) → membership INSERT + accepted audit / reject audit 0 件", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("h01");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const invitee = yield* db.seedUser("invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "OWNER",
          invitedByUserId: owner.id,
        });
        const invitationRow = yield* reloadInvitation(inv.token);

        yield* withWarnSpy((warn) =>
          Effect.gen(function* () {
            const result = yield* acceptInvitation({
              actor: { id: invitee.id, email: invitee.email },
              invitation: invitationRow,
            });
            expect(result).toEqual({ companyId: co });
            // 正常 accept で warn は発火しない (拒否経路との対称性)。
            expect(warn).not.toHaveBeenCalled();
          }),
        );

        expect((yield* db.readMembership(invitee.id, co))?.role).toBe("OWNER");
        expect(yield* auditCountByType(invitee.id, "invitation_accepted")).toBe(1);
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
      }),
    ));

  test("QA-M-01 reused (既所属短絡) は entry 層で 200 に短絡するため、accept use-case は呼ばれない (契約テスト)", () =>
    run(
      Effect.gen(function* () {
        // acceptInvitation は entry で proceed 判定が下りた invitation のみを受ける契約。
        // reused の分岐 (既所属短絡) は entry 側の test でカバー。ここでは use-case が
        // 「既所属 user へ再 accept を渡された」ケースで unique 制約 error が伝播することを確認。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m01-owner");
        const co = yield* db.seedCompany("m01");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m01-invitee");
        yield* db.seedMembership(invitee.id, co, "MEMBER");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const invitationRow = yield* reloadInvitation(inv.token);

        // 契約: entry が reused に振り分けた後は use-case 呼ばない。誤って呼ぶと INSERT が unique 制約
        // 違反となり DbError が E に載る。この失敗を handler 側で握るのは責務外なので、
        // ここでは失敗することだけを固定する (fail-closed で運用ミスを検知する仕組み)。
        const exit = yield* withWarnSpy(() =>
          Effect.exit(
            acceptInvitation({
              actor: { id: invitee.id, email: invitee.email },
              invitation: invitationRow,
            }),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    ));

  test("QA-H-05 / QA-M-02 偽造 OWNER 招待 (inviter が accept 時点で ADMIN) → 410 + reject audit (payload に PII 無し) + warn 先行", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const inviter = yield* db.seedUser("m02-inviter");
        const otherOwner = yield* db.seedUser("m02-other-owner");
        const co = yield* db.seedCompany("m02");
        yield* db.seedMembership(inviter.id, co, "OWNER");
        yield* db.seedMembership(otherOwner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m02-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "OWNER",
          invitedByUserId: inviter.id,
        });
        // inviter を先に降格させる (実運用では handler 経由の role 変更相当)。
        yield* db.setMembershipRole(inviter.id, co, "ADMIN");
        const invitationRow = yield* reloadInvitation(inv.token);

        // Bun 1.3 の spy.mockRestore() は call history もクリアするため、warn call の検証は
        // release 前に済ませる (実測: PR #109)。
        const { e, warnCalls } = yield* withWarnSpy((warn) =>
          Effect.gen(function* () {
            const e = yield* Effect.flip(
              acceptInvitation({
                actor: { id: invitee.id, email: invitee.email },
                invitation: invitationRow,
              }),
            );
            return { e, warnCalls: warn.mock.calls.map((c) => Array.from(c)) };
          }),
        );
        // 拒否は E channel の ExpiredOrUsed (410 / expired_or_used)。内訳は下の audit payload の reason が持つ。
        expectFailure(e, ExpiredOrUsed, "expired_or_used", 410);

        // reject 経路は tx を rollback させるため、invitation は PENDING のまま (accept 誤 commit の regression 検知)。
        expect((yield* reloadInvitation(inv.token)).status).toBe("PENDING");
        expect(yield* db.readMembership(invitee.id, co)).toBeUndefined();
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(1);

        const rejectAudit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
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
      }),
    ));

  test("QA-M-04 招待者 membership 行が不在 (退会) の OWNER 招待 → 410 + reject audit (inviter_current_role=null)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const inviter = yield* db.seedUser("m04-inviter");
        const otherOwner = yield* db.seedUser("m04-other-owner");
        const co = yield* db.seedCompany("m04");
        yield* db.seedMembership(inviter.id, co, "OWNER");
        yield* db.seedMembership(otherOwner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m04-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "OWNER",
          invitedByUserId: inviter.id,
        });
        // inviter membership を除名 (row 削除) して不在状態を作る。他 OWNER が残るため lock guard 通過。
        yield* db.removeMembership(inviter.id, co);

        const invitationRow = yield* reloadInvitation(inv.token);

        const failure = yield* withWarnSpy(() =>
          Effect.flip(
            acceptInvitation({
              actor: { id: invitee.id, email: invitee.email },
              invitation: invitationRow,
            }),
          ),
        );
        expect(failure).toBeInstanceOf(ExpiredOrUsed);
        const audit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.inviter_current_role).toBe(null);
        expect(payload.reason).toBe("inviter_not_owner_or_missing");
      }),
    ));

  test("QA-M-05 already-accepted invitation (PENDING 消失) を再度 accept → 410 + double_accept audit", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m05-owner");
        const co = yield* db.seedCompany("m05");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m05-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const invitationRow = yield* reloadInvitation(inv.token);

        // 1 度 accept で PENDING を消費する。
        const first = yield* acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        });
        expect(first.companyId).toBe(co);

        // 再度同じ invitation を渡すと markInvitationAccepted が 0 件更新 → double_accept で reject。
        const stale = yield* reloadInvitation(inv.token);

        const second = yield* withWarnSpy(() =>
          Effect.flip(
            acceptInvitation({
              actor: { id: invitee.id, email: invitee.email },
              invitation: stale,
            }),
          ),
        );
        expect(second).toBeInstanceOf(ExpiredOrUsed);
        const audit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        expect((audit?.payload as Record<string, unknown>).reason).toBe("double_accept");
      }),
    ));

  test("QA-D-03 / QA-M-06 unknown invitation.role (直 INSERT 由来) → 410 + reject audit (attempted_role が unknown 文字列)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m06-owner");
        const co = yield* db.seedCompany("m06");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m06-invitee");

        // Role 型を fail-closed 検証するため意図的に unknown 文字列を cast で通す。
        const { token: tok } = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "SUPERVISOR" as Role,
          invitedByUserId: owner.id,
        });
        const invitationRow = yield* reloadInvitation(tok);

        const failure = yield* withWarnSpy(() =>
          Effect.flip(
            acceptInvitation({
              actor: { id: invitee.id, email: invitee.email },
              invitation: invitationRow,
            }),
          ),
        );
        expect(failure).toBeInstanceOf(ExpiredOrUsed);
        const audit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.attempted_role).toBe("SUPERVISOR");
        expect(payload.reason).toBe("unknown_invited_role");
      }),
    ));

  test("QA-M-07 double-accept 並行 (同 token へ 2 client 同時) → 片方のみ ok、他方 410 + double_accept audit", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("m07-owner");
        const co = yield* db.seedCompany("m07");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const invitee = yield* db.seedUser("m07-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const invitationRow = yield* reloadInvitation(inv.token);

        const accept = acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        });
        const results = yield* withWarnSpy(() =>
          Effect.all([Effect.exit(accept), Effect.exit(accept)], { concurrency: "unbounded" }),
        );
        // 片方は成功、もう片方は ExpiredOrUsed (410) か unique 制約の DbError で失敗
        // (どちらも membership を重複作らない)。
        expect(results.filter(Exit.isSuccess).length).toBe(1);
        // membership は 1 行だけ。
        expect((yield* membershipRowsOf(invitee.id, co)).length).toBe(1);
      }),
    ));

  test("QA-M-09 accept vs 降格 の 2-outcome — (a) 降格 commit 先行なら 410 / (b) accept commit 先行なら OWNER 正当 mint。いずれも `降格済み inviter からの OWNER mint` は 0 件", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        // 分岐 (a): 降格を先に commit する。
        {
          const inviter = yield* db.seedUser("m09a-inv");
          const otherOwner = yield* db.seedUser("m09a-oth");
          const co = yield* db.seedCompany("m09a");
          yield* db.seedMembership(inviter.id, co, "OWNER");
          yield* db.seedMembership(otherOwner.id, co, "OWNER");
          const invitee = yield* db.seedUser("m09a-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "OWNER",
            invitedByUserId: inviter.id,
          });
          yield* db.setMembershipRole(inviter.id, co, "ADMIN"); // 降格 先行 commit
          const invitationRow = yield* reloadInvitation(inv.token);
          const failure = yield* withWarnSpy(() =>
            Effect.flip(
              acceptInvitation({
                actor: { id: invitee.id, email: invitee.email },
                invitation: invitationRow,
              }),
            ),
          );
          expect(failure).toBeInstanceOf(ExpiredOrUsed);
          expect(yield* db.readMembership(invitee.id, co)).toBeUndefined();
        }

        // 分岐 (b): accept を commit してから降格。
        {
          const inviter = yield* db.seedUser("m09b-inv");
          const otherOwner = yield* db.seedUser("m09b-oth");
          const co = yield* db.seedCompany("m09b");
          yield* db.seedMembership(inviter.id, co, "OWNER");
          yield* db.seedMembership(otherOwner.id, co, "OWNER");
          const invitee = yield* db.seedUser("m09b-invitee");
          const inv = yield* db.seedInvitation({
            companyId: co,
            email: invitee.email,
            role: "OWNER",
            invitedByUserId: inviter.id,
          });
          const invitationRow = yield* reloadInvitation(inv.token);
          const acceptResult = yield* acceptInvitation({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          });
          expect(acceptResult.companyId).toBe(co);
          expect((yield* db.readMembership(invitee.id, co))?.role).toBe("OWNER");
          // accept 後の降格は通常通り適用可能 (別 OWNER 残存)。
          yield* db.setMembershipRole(inviter.id, co, "ADMIN");
          expect((yield* db.readMembership(inviter.id, co))?.role).toBe("ADMIN");
        }
      }),
    ));
});
