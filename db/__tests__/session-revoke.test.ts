import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { findSessionRevokedAt, revokeAllSessionsForUser } from "../repositories/session";
import { deleteUser as deleteUserRepo } from "../repositories/user";
import { session, user } from "../schema";
import { runInTransaction } from "../transaction";

const testUserId = "test-revoke-user";
const testSessionA = "test-revoke-session-a";
const testSessionB = "test-revoke-session-b";

describe("session revoke repository", () => {
  beforeAll(async () => {
    await db.delete(session).where(eq(session.id, testSessionA));
    await db.delete(session).where(eq(session.id, testSessionB));
    await db.delete(user).where(eq(user.id, testUserId));
    await db.insert(user).values({
      id: testUserId,
      name: "Revoke",
      email: "revoke-test@example.com",
      emailVerified: false,
    });
    await db.insert(session).values([
      {
        id: testSessionA,
        userId: testUserId,
        token: "tok-a",
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        id: testSessionB,
        userId: testUserId,
        token: "tok-b",
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, testUserId));
  });

  test("revokeAllSessionsForUser sets revoked_at on all active sessions of the user", async () => {
    await revokeAllSessionsForUser(testUserId);

    const revokedA = await findSessionRevokedAt(testSessionA);
    const revokedB = await findSessionRevokedAt(testSessionB);
    expect(revokedA).not.toBeNull();
    expect(revokedB).not.toBeNull();
    expect(revokedA!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("revokeAllSessionsForUser is idempotent (re-running does not overwrite older revoked_at)", async () => {
    const first = await findSessionRevokedAt(testSessionA);
    await new Promise((r) => setTimeout(r, 20));
    await revokeAllSessionsForUser(testUserId);
    const second = await findSessionRevokedAt(testSessionA);
    expect(first?.getTime()).toBe(second?.getTime());
  });

  test("findSessionRevokedAt returns null for unknown session", async () => {
    const got = await findSessionRevokedAt("nonexistent-session-id");
    expect(got).toBeNull();
  });
});

describe("deleteUser within transaction (revoke + cascade delete)", () => {
  const txTestUserId = "test-revoke-tx-user";
  const txTestSessionId = "test-revoke-tx-session";

  beforeAll(async () => {
    await db.delete(session).where(eq(session.id, txTestSessionId));
    await db.delete(user).where(eq(user.id, txTestUserId));
    await db.insert(user).values({
      id: txTestUserId,
      name: "Tx",
      email: "revoke-tx-test@example.com",
      emailVerified: false,
    });
    await db.insert(session).values({
      id: txTestSessionId,
      userId: txTestUserId,
      token: "tx-tok",
      expiresAt: new Date(Date.now() + 86400000),
    });
  });

  test("revoke + cascade delete atomic in tx (session row vanishes after delete)", async () => {
    await runInTransaction(async (tx) => {
      await revokeAllSessionsForUser(txTestUserId, tx);
      return deleteUserRepo(txTestUserId, tx);
    });

    const rows = await db.select().from(session).where(eq(session.id, txTestSessionId));
    expect(rows.length).toBe(0);
    const users = await db.select().from(user).where(eq(user.id, txTestUserId));
    expect(users.length).toBe(0);
  });
});
