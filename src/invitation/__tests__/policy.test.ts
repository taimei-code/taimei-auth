import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { InvitationRow } from "@/db/repositories/invitation";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { isAcceptableAt } from "../policy";
import { InvitationRepo } from "../ports";

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);

const rowOf = (over: Partial<InvitationRow>): InvitationRow =>
  ({
    id: "inv1",
    token: "tok",
    email: "u1@example.com",
    companyId: "c1",
    role: "MEMBER",
    invitedByUserId: "owner",
    status: "PENDING",
    expiresAt: new Date(NOW + 60_000),
    acceptedAt: null,
    revokedAt: null,
    usedAt: null,
    createdAt: new Date(NOW - 60_000),
    ...over,
  }) as InvitationRow;

describe("isAcceptableAt", () => {
  test("PENDING かつ期限内 → true", () => {
    expect(isAcceptableAt(rowOf({}), NOW)).toBe(true);
  });

  test("期限切れ PENDING → false (status は PENDING のまま derived expired)", () => {
    const row = rowOf({ expiresAt: new Date(NOW - 1000) });
    expect(row.status).toBe("PENDING");
    expect(isAcceptableAt(row, NOW)).toBe(false);
  });

  test("expires_at ちょうど → false (strict greater)", () => {
    expect(isAcceptableAt(rowOf({ expiresAt: new Date(NOW) }), NOW)).toBe(false);
  });

  test("ACCEPTED / REVOKED は期限内でも false", () => {
    expect(isAcceptableAt(rowOf({ status: "ACCEPTED" }), NOW)).toBe(false);
    expect(isAcceptableAt(rowOf({ status: "REVOKED" }), NOW)).toBe(false);
  });
});

describe("未対応で期限内の判定は、repository の SQL と isAcceptableAt で同じ向き", () => {
  const { run, cleanup } = dbTest("policy-test-");
  beforeEach(cleanup);
  afterAll(cleanup);

  test("期限がちょうど now の招待を、repository の SQL と isAcceptableAt の両方が期限切れとする", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("expiry");
        const now = new Date(Date.now() + 3_600_000);
        const seeded = yield* db.seedInvitation({
          companyId: co,
          email: "policy-test-invitee@example.com",
          role: "MEMBER",
          invitedByUserId: owner.id,
          expiresAt: now,
        });
        const row = yield* db.readInvitationByToken(seeded.token);
        if (!row) throw new Error("seed failed");

        const foundBySql = yield* InvitationRepo.use((repo) =>
          repo.findActivePendingInvitation(co, row.email, now),
        );

        expect(foundBySql).toBeUndefined();
        expect(isAcceptableAt(row, now.getTime())).toBe(false);
      }),
    ));
});
