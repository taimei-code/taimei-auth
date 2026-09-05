import { describe, expect, test } from "bun:test";
import type { InvitationRow } from "@/db/repositories/invitation";
import { isAcceptableAt } from "../policy";

// 受諾可否の述語 (PENDING かつ期限内) の SSOT。expired は status 列でなく expires_at から導出する
// (status は PENDING / ACCEPTED / REVOKED の 3 値のみ)。時刻は引数で受け、Date.now() に依存しない。

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
