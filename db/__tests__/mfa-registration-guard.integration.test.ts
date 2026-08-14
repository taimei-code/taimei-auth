import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "../client";
import {
  acquireRegistrationGuard,
  readRegistrationGuardProtocolVersion,
  releaseRegistrationGuard,
  releaseRegistrationGuardByManagement,
} from "../repositories/mfa-registration";
import { auditLog, mfaRegistrationTransitionGuard, user } from "../schema";

// db/ 配下に置くのは、未 commit の競合 insert を作るための生 pg 接続が要るため
// (src/ からの pg 直 import は db/CLAUDE.md ルール 1 が禁じる)。

const PREFIX = "mfa-registration-guard-test-";

async function cleanup() {
  // audit_log.user_id は FK を持たないため、user 行の削除だけでは QA-D-05 が書く
  // mfa_registration_guard_released 行が共有 DB に累積する。user id は PREFIX 始まりで採番
  // しているので、prefix 一致で audit 側も掃除する。
  await db.delete(auditLog).where(like(auditLog.userId, `${PREFIX}%`));
  await db.delete(user).where(eq(user.email, `${PREFIX}user@example.com`));
}

async function seedUser() {
  const id = `${PREFIX}${randomUUID()}`;
  await db.insert(user).values({ id, email: `${PREFIX}user@example.com`, name: "MFA guard test" });
  return id;
}

test("reads the seeded management protocol version", async () => {
  expect(await readRegistrationGuardProtocolVersion()).toBe(1);
});

describe("MFA registration guard repository", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-E-05 allows one guard per user and stale tokens cannot release it", async () => {
    const userId = await seedUser();
    const acquired = await acquireRegistrationGuard(userId, "enroll");
    expect(acquired.acquired).toBe(true);
    if (!acquired.acquired) throw new Error("guard was not acquired");

    const blocked = await acquireRegistrationGuard(userId, "activate");
    expect(blocked).toMatchObject({ acquired: false, cause: "held" });
    expect(
      await releaseRegistrationGuard({ ...acquired.lease, token: "stale-operation-token" }),
    ).toEqual({ released: false });
    expect(await releaseRegistrationGuard(acquired.lease)).toEqual({ released: true });
  });

  test("QA-E-05 bounds an uncommitted unique-key wait", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for this integration test");
    const userId = await seedUser();
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into mfa_registration_transition_guard
          (user_id, operation_token, operation_kind) values ($1, $2, 'enroll')`,
        [userId, randomUUID()],
      );
      const startedAt = performance.now();

      const blocked = await acquireRegistrationGuard(userId, "disable");
      expect(blocked.acquired).toBe(false);
      expect(performance.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  });

  test("user 行が無い userId は user_absent (busy と区別して恒久条件を返す)", async () => {
    expect(await acquireRegistrationGuard(`${PREFIX}missing`, "enroll")).toEqual({
      acquired: false,
      cause: "user_absent",
    });
  });

  test("QA-D-05 concurrent management releases write at most one audit event", async () => {
    const userId = await seedUser();
    const acquired = await acquireRegistrationGuard(userId, "activate");
    expect(acquired.acquired).toBe(true);

    const releases = await Promise.all([
      releaseRegistrationGuardByManagement({
        userId,
        source: "test",
        reason: "incident-1",
        processStoppedConfirmed: true,
      }),
      releaseRegistrationGuardByManagement({
        userId,
        source: "test",
        reason: "incident-2",
        processStoppedConfirmed: true,
      }),
    ]);
    expect(releases.filter((result) => result.released)).toHaveLength(1);

    const events = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.userId, userId), eq(auditLog.eventType, "mfa_registration_guard_released")),
      );
    expect(events).toHaveLength(1);
  });

  test("QA-I-01 user deletion removes its guard by cascade", async () => {
    const userId = await seedUser();
    expect((await acquireRegistrationGuard(userId, "enroll")).acquired).toBe(true);

    await db.delete(user).where(eq(user.id, userId));

    const rows = await db
      .select()
      .from(mfaRegistrationTransitionGuard)
      .where(eq(mfaRegistrationTransitionGuard.userId, userId));
    expect(rows).toEqual([]);
  });
});
