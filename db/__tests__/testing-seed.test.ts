import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { appendAuditLog } from "../repositories/audit-log";
import {
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  markInvitationAccepted,
  markInvitationRevoked,
} from "../repositories/invitation";
import type { Role } from "../schema";
import { createSeed, ids } from "../testing/seed";
import {
  readAuditRows,
  readCompany,
  readInvitation,
  readMembership,
  readPendingInvitation,
  readSessions,
  readUser,
} from "../testing/read";

// db/testing/* (test の seed / 観測 (事後状態の読み取り) の正本) が「明示した状態を作る」ことと、production の状態遷移と同じ列を
// 書くことを固定する。

const P = "dbseed-test-";
const seed = createSeed(P);

// createSeed の公開面 (11 関数) を型で固定する (AC-208)。
const SEED_KEYS = {
  seedUser: true,
  seedSession: true,
  seedCompany: true,
  seedMembership: true,
  seedInvitation: true,
  markCompanyDeleted: true,
  setMembershipRole: true,
  setLastUsedCompany: true,
  setUserCreatedAt: true,
  removeMembership: true,
  cleanup: true,
} satisfies Record<keyof ReturnType<typeof createSeed>, true>;

const nullness = (row: {
  status: string;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  usedAt: Date | null;
}) => [row.status, row.acceptedAt !== null, row.revokedAt !== null, row.usedAt !== null];

describe("db/testing seed", () => {
  beforeEach(seed.cleanup);
  afterAll(seed.cleanup);

  test("seedUser の既定は emailVerified=true で session 行を作らない。明示 false と seedSession は反映される", async () => {
    const x = await seed.seedUser("x");
    expect((await readUser(x.id))?.emailVerified).toBe(true);
    expect(await readSessions(x.id)).toEqual([]);

    const y = await seed.seedUser("y", { emailVerified: false });
    expect((await readUser(y.id))?.emailVerified).toBe(false);

    await seed.seedSession(y.id);
    expect((await readSessions(y.id)).length).toBe(1);
  });

  test("seedUser の createdAt と setUserCreatedAt は行に反映される", async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const u = await seed.seedUser("old", { createdAt: old });
    expect((await readUser(u.id))?.createdAt.getTime()).toBe(old.getTime());

    const older = new Date(Date.now() - 96 * 60 * 60 * 1000);
    await seed.setUserCreatedAt(u.id, older);
    expect((await readUser(u.id))?.createdAt.getTime()).toBe(older.getTime());
  });

  test("seedInvitation の ACCEPTED / REVOKED は production の markInvitation* と同じ列を書き、PENDING は 3 列 null", async () => {
    const owner = await seed.seedUser("owner");
    const co = await seed.seedCompany("inv");
    const base = { companyId: co, email: ids(P).email("invitee"), invitedByUserId: owner.id };

    const viaProduction = async (transition: "ACCEPTED" | "REVOKED") => {
      const row = await insertInvitation({
        id: generateInvitationId(),
        role: "MEMBER",
        token: generateInvitationToken(),
        expiresAt: new Date(Date.now() + 60_000),
        ...base,
      });
      const moved =
        transition === "ACCEPTED"
          ? await markInvitationAccepted(row.id)
          : await markInvitationRevoked(row.id, co);
      if (!moved) throw new Error("transition failed");
      return moved;
    };

    for (const status of ["ACCEPTED", "REVOKED"] as const) {
      const seeded = await seed.seedInvitation({ ...base, role: "MEMBER", status });
      const seededRow = await readInvitation(seeded.id);
      if (!seededRow) throw new Error("seed failed");
      expect(nullness(seededRow)).toEqual(nullness(await viaProduction(status)));
    }

    const pending = await seed.seedInvitation({ ...base, role: "MEMBER" });
    const pendingRow = await readInvitation(pending.id);
    expect(pendingRow && nullness(pendingRow)).toEqual(["PENDING", false, false, false]);
  });

  test("createSeed の公開面は 11 関数 (AC-208)", () => {
    expect(Object.keys(seed).sort()).toEqual(Object.keys(SEED_KEYS).sort());
  });

  test("seedInvitation は unknown role をそのまま書く (fail-closed 検査用、cast で通す)", async () => {
    const owner = await seed.seedUser("owner");
    const co = await seed.seedCompany("role");
    const inv = await seed.seedInvitation({
      companyId: co,
      email: ids(P).email("sup"),
      role: "SUPERVISOR" as Role,
      invitedByUserId: owner.id,
    });
    expect(String((await readInvitation(inv.id))?.role)).toBe("SUPERVISOR");
  });

  test("markCompanyDeleted は既定で deleted_at も書き、deletedAt: false なら status だけ変える", async () => {
    const full = await seed.seedCompany("full");
    await seed.markCompanyDeleted(full);
    const fullRow = await readCompany(full);
    expect([fullRow?.activationStatus, fullRow?.deletedAt !== null]).toEqual(["DELETED", true]);

    const statusOnly = await seed.seedCompany("status");
    await seed.markCompanyDeleted(statusOnly, { deletedAt: false });
    const statusRow = await readCompany(statusOnly);
    expect([statusRow?.activationStatus, statusRow?.deletedAt]).toEqual(["DELETED", null]);
  });

  test("readPendingInvitation は PENDING かつ expires_at > now (strict) だけを返す", async () => {
    const owner = await seed.seedUser("owner");
    const co = await seed.seedCompany("pend");
    const now = new Date();
    const email = ids(P).email("p");
    const day = 24 * 60 * 60 * 1000;
    const make = (status: "PENDING" | "ACCEPTED" | "REVOKED", expiresAt: Date, suffix: string) =>
      seed.seedInvitation({
        companyId: co,
        email: ids(P).email(suffix),
        role: "MEMBER",
        invitedByUserId: owner.id,
        status,
        expiresAt,
      });

    const future = await make("PENDING", new Date(now.getTime() + day), "p");
    expect((await readPendingInvitation(co, email, now))?.id).toBe(future.id);

    await make("PENDING", new Date(now.getTime() - day), "past");
    expect(await readPendingInvitation(co, ids(P).email("past"), now)).toBeUndefined();
    await make("PENDING", now, "edge");
    expect(await readPendingInvitation(co, ids(P).email("edge"), now)).toBeUndefined();
    await make("ACCEPTED", new Date(now.getTime() + day), "acc");
    expect(await readPendingInvitation(co, ids(P).email("acc"), now)).toBeUndefined();
    await make("REVOKED", new Date(now.getTime() + day), "rev");
    expect(await readPendingInvitation(co, ids(P).email("rev"), now)).toBeUndefined();
  });

  test("cleanup は 6 table の prefix 行を全部消す (消す前に各 table に行がある)", async () => {
    const owner = await seed.seedUser("c-owner");
    const co = await seed.seedCompany("c");
    await seed.seedSession(owner.id);
    await seed.seedMembership(owner.id, co, "OWNER");
    const inv = await seed.seedInvitation({
      companyId: co,
      email: ids(P).email("c-invitee"),
      role: "MEMBER",
      invitedByUserId: owner.id,
    });
    await appendAuditLog({ eventType: "account_delete", userId: owner.id, payload: {} });

    expect((await readSessions(owner.id)).length).toBe(1);
    expect(await readMembership(owner.id, co)).toBeDefined();
    expect(await readInvitation(inv.id)).toBeDefined();
    expect((await readAuditRows(owner.id, "account_delete")).length).toBe(1);

    await seed.cleanup();

    expect(await readUser(owner.id)).toBeUndefined();
    expect(await readCompany(co)).toBeUndefined();
    expect(await readSessions(owner.id)).toEqual([]);
    expect(await readMembership(owner.id, co)).toBeUndefined();
    expect(await readInvitation(inv.id)).toBeUndefined();
    expect(await readAuditRows(owner.id, "account_delete")).toEqual([]);
  });
});
