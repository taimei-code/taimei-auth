import { afterAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import { ExpiredOrUsed } from "../../membership/guard/errors";
import { auditRowsFor, dbTest, expectFailure, withSpy } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { acceptInvitation } from "../accept";

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

const withWarnSpy = <A, E, R>(use: (warn: Mock<typeof console.warn>) => Effect.Effect<A, E, R>) =>
  withSpy(() => spyOn(console, "warn").mockImplementation(() => {}), use);

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
        yield* db.setMembershipRole(inviter.id, co, "ADMIN");
        const invitationRow = yield* reloadInvitation(inv.token);

        // warn の検証は withSpy の release 前に済ませる (Bun の mockRestore は呼び出し履歴も消す)。
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
        expectFailure(e, ExpiredOrUsed, "expired_or_used", 410);

        expect((yield* reloadInvitation(inv.token)).status).toBe("PENDING");
        expect(yield* db.readMembership(invitee.id, co)).toBeUndefined();
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(1);

        const rejectAudit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        const payload = rejectAudit?.payload as Record<string, unknown>;
        expect(payload.invitation_id).toBe(inv.id);
        expect(payload.company_id).toBe(co);
        expect(payload.invited_by_user_id).toBe(inviter.id);
        expect(payload.attempted_role).toBe("OWNER");
        expect(payload.inviter).toEqual({ _tag: "Demoted", role: "ADMIN" });
        expect(payload.reason).toBe("inviter_not_owner_or_missing");
        expect(payload).not.toHaveProperty("email");
        expect(payload).not.toHaveProperty("invited_email");

        expect(warnCalls.length).toBeGreaterThanOrEqual(1);
        const call = warnCalls.at(-1);
        expect(call?.[0]).toBe("invitation_accept_rejected");
        expect(String(call?.[1] ?? "")).toContain(`"invitation_id":"${inv.id}"`);
      }),
    ));

  test("QA-M-04 招待者 membership 行が不在 (退会) の OWNER 招待 → 410 + reject audit (inviter=Missing)", () =>
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
        expect(payload.inviter).toEqual({ _tag: "Missing" });
        expect(payload.reason).toBe("inviter_not_owner_or_missing");
      }),
    ));

  test("QA-M-06 招待者が退会済みの MEMBER 招待 → accept 成功 (再検証は OWNER 招待だけ)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const inviter = yield* db.seedUser("m06-inviter");
        const co = yield* db.seedCompany("m06");
        yield* db.seedMembership(inviter.id, co, "OWNER");
        const invitee = yield* db.seedUser("m06-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "MEMBER",
          invitedByUserId: inviter.id,
        });
        yield* db.removeMembership(inviter.id, co);
        const invitationRow = yield* reloadInvitation(inv.token);

        const result = yield* acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        });
        expect(result).toEqual({ companyId: co });
        expect((yield* db.readMembership(invitee.id, co))?.role).toBe("MEMBER");
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
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

        const first = yield* acceptInvitation({
          actor: { id: invitee.id, email: invitee.email },
          invitation: invitationRow,
        });
        expect(first.companyId).toBe(co);

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
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.reason).toBe("double_accept");
        expect(payload.inviter).toBe(null);
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
        expect(results.filter(Exit.isSuccess).length).toBe(1);
        expect((yield* membershipRowsOf(invitee.id, co)).length).toBe(1);
      }),
    ));

  test("QA-M-09 accept vs 降格 の 2-outcome — (a) 降格 commit 先行なら 410 / (b) accept commit 先行なら OWNER 正当 mint。いずれも `降格済み inviter からの OWNER mint` は 0 件", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
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
          yield* db.setMembershipRole(inviter.id, co, "ADMIN");
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
          yield* db.setMembershipRole(inviter.id, co, "ADMIN");
          expect((yield* db.readMembership(inviter.id, co))?.role).toBe("ADMIN");
        }
      }),
    ));
});
