import { afterAll, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import { ExpiredOrUsed } from "../errors";
import { auditRowsFor, dbTest, expectFailure, withSpy } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { auditLogWith } from "../../__tests__/test-layers";
import { DbError } from "../../errors";
import { acceptInvitation } from "../accept";
import { acceptGrantForTest } from "../../membership/__tests__/verified-for-test";

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

  test("OWNER のままの招待者による OWNER 招待を受諾すると、membership を作って accepted の audit を残し、reject の audit は残さない", () =>
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
            const result = yield* acceptInvitation(
              acceptGrantForTest({
                actor: { id: invitee.id, email: invitee.email },
                invitation: invitationRow,
              }),
            );
            expect(result).toEqual({ companyId: co });
            expect(warn).not.toHaveBeenCalled();
          }),
        );

        expect((yield* db.readMembership(invitee.id, co))?.role).toBe("OWNER");
        expect(
          (yield* auditRowsFor(invitee.id, "invitation_accepted")).map((r) => r.payload),
        ).toEqual([
          { invitation_id: inv.id, company_id: co, accepted_by_user_id: invitee.id, role: "OWNER" },
        ]);
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
        expect((yield* db.readUser(invitee.id))?.lastUsedCompanyId).toBe(co);
      }),
    ));

  test("既に所属している user の受諾は入口で 200 を返すので、accept の use-case は呼ばれない", () =>
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
            acceptInvitation(
              acceptGrantForTest({
                actor: { id: invitee.id, email: invitee.email },
                invitation: invitationRow,
              }),
            ),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    ));

  test("受諾の時点で招待者が ADMIN に降格した OWNER 招待は 410 を返し、warning の後に PII を含まない reject の audit を残す", () =>
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

        const { e, warnCalls } = yield* withWarnSpy((warn) =>
          Effect.gen(function* () {
            const e = yield* Effect.flip(
              acceptInvitation(
                acceptGrantForTest({
                  actor: { id: invitee.id, email: invitee.email },
                  invitation: invitationRow,
                }),
              ),
            );
            return { e, warnCalls: warn.mock.calls.map((c) => Array.from(c)) };
          }),
        );
        expectFailure(e, ExpiredOrUsed);

        expect((yield* reloadInvitation(inv.token)).status).toBe("PENDING");
        expect(yield* db.readMembership(invitee.id, co)).toBeUndefined();
        expect((yield* db.readUser(invitee.id))?.lastUsedCompanyId).toBeNull();
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

  test("拒否の audit の書き込みが失敗しても、応答は ExpiredOrUsed のままで、invitation_accept_rejected の warn の行が出る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const inviter = yield* db.seedUser("rej-audit-inviter");
        const otherOwner = yield* db.seedUser("rej-audit-other-owner");
        const co = yield* db.seedCompany("rej-audit");
        yield* db.seedMembership(inviter.id, co, "OWNER");
        yield* db.seedMembership(otherOwner.id, co, "OWNER");
        const invitee = yield* db.seedUser("rej-audit-invitee");
        const inv = yield* db.seedInvitation({
          companyId: co,
          email: invitee.email,
          role: "OWNER",
          invitedByUserId: inviter.id,
        });
        yield* db.setMembershipRole(inviter.id, co, "ADMIN");
        const invitationRow = yield* reloadInvitation(inv.token);
        const failingAudit = auditLogWith(() => ({
          appendAuditLog: () => Effect.fail(new DbError({ cause: "audit store down" })),
        }));

        const { e, warnCalls } = yield* withWarnSpy((warn) =>
          Effect.gen(function* () {
            const e = yield* Effect.flip(
              acceptInvitation(
                acceptGrantForTest({
                  actor: { id: invitee.id, email: invitee.email },
                  invitation: invitationRow,
                }),
              ).pipe(Effect.provide(failingAudit)),
            );
            return { e, warnCalls: warn.mock.calls.map((c) => Array.from(c)) };
          }),
        );

        expectFailure(e, ExpiredOrUsed);
        expect(warnCalls.map((call) => call[0])).toContain("invitation_accept_rejected");
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
      }),
    ));

  test("招待者が退会して membership が無い OWNER 招待は 410 を返し、inviter=Missing の reject の audit を残す", () =>
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
            acceptInvitation(
              acceptGrantForTest({
                actor: { id: invitee.id, email: invitee.email },
                invitation: invitationRow,
              }),
            ),
          ),
        );
        expect(failure).toBeInstanceOf(ExpiredOrUsed);
        const audit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.inviter).toEqual({ _tag: "Missing" });
        expect(payload.reason).toBe("inviter_not_owner_or_missing");
      }),
    ));

  test("招待者が退会済みでも MEMBER 招待は受諾できる (招待者を確かめ直すのは OWNER 招待だけ)", () =>
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

        const result = yield* acceptInvitation(
          acceptGrantForTest({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        );
        expect(result).toEqual({ companyId: co });
        expect((yield* db.readMembership(invitee.id, co))?.role).toBe("MEMBER");
        expect(yield* auditCountByType(invitee.id, "invitation_accept_rejected")).toBe(0);
      }),
    ));

  test("受諾済みの invitation をもう一度受諾すると 410 を返し、double_accept の audit を残す", () =>
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

        const first = yield* acceptInvitation(
          acceptGrantForTest({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        );
        expect(first.companyId).toBe(co);

        const stale = yield* reloadInvitation(inv.token);

        const second = yield* withWarnSpy(() =>
          Effect.flip(
            acceptInvitation(
              acceptGrantForTest({
                actor: { id: invitee.id, email: invitee.email },
                invitation: stale,
              }),
            ),
          ),
        );
        expect(second).toBeInstanceOf(ExpiredOrUsed);
        const audit = yield* firstAudit(invitee.id, "invitation_accept_rejected");
        const payload = audit?.payload as Record<string, unknown>;
        expect(payload.reason).toBe("double_accept");
        expect(payload.inviter).toBe(null);
      }),
    ));

  test("同じ token を 2 つの client が同時に受諾すると、片方だけが成功し、もう片方は 410 で double_accept の audit を残す", () =>
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

        const accept = acceptInvitation(
          acceptGrantForTest({
            actor: { id: invitee.id, email: invitee.email },
            invitation: invitationRow,
          }),
        );
        const results = yield* withWarnSpy(() =>
          Effect.all([Effect.exit(accept), Effect.exit(accept)], { concurrency: "unbounded" }),
        );
        expect(results.filter(Exit.isSuccess).length).toBe(1);
        expect((yield* membershipRowsOf(invitee.id, co)).length).toBe(1);
      }),
    ));

  test("受諾と招待者の降格が競合すると、降格が先に commit すれば 410、受諾が先なら正当な OWNER になり、降格済みの招待者から OWNER が生まれることは無い", () =>
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
              acceptInvitation(
                acceptGrantForTest({
                  actor: { id: invitee.id, email: invitee.email },
                  invitation: invitationRow,
                }),
              ),
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
          const acceptResult = yield* acceptInvitation(
            acceptGrantForTest({
              actor: { id: invitee.id, email: invitee.email },
              invitation: invitationRow,
            }),
          );
          expect(acceptResult.companyId).toBe(co);
          expect((yield* db.readMembership(invitee.id, co))?.role).toBe("OWNER");
          yield* db.setMembershipRole(inviter.id, co, "ADMIN");
          expect((yield* db.readMembership(inviter.id, co))?.role).toBe("ADMIN");
        }
      }),
    ));
});
