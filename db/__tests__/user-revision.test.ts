import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { account, user } from "../schema";

const testUserId = "test-revision-user";

describe("user.revision DB trigger", () => {
  beforeAll(async () => {
    await db.delete(user).where(eq(user.id, testUserId));
    await db.insert(user).values({
      id: testUserId,
      name: "Initial",
      email: "revision-test@example.com",
      emailVerified: false,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, testUserId));
  });

  test("initial revision is 0", async () => {
    const row = await db.select().from(user).where(eq(user.id, testUserId)).limit(1);
    expect(row[0]?.revision).toBe(0);
  });

  test("changing name increments revision", async () => {
    await db.update(user).set({ name: "Changed" }).where(eq(user.id, testUserId));
    const row = await db.select().from(user).where(eq(user.id, testUserId)).limit(1);
    expect(row[0]?.revision).toBe(1);
  });

  test("changing email increments revision", async () => {
    await db.update(user).set({ email: "changed@example.com" }).where(eq(user.id, testUserId));
    const row = await db.select().from(user).where(eq(user.id, testUserId)).limit(1);
    expect(row[0]?.revision).toBe(2);
  });

  test("no-op update (same values) does NOT increment revision", async () => {
    const before = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    if (!before) throw new Error("user not found");
    await db.update(user).set({ name: before.name }).where(eq(user.id, testUserId));
    const after = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    expect(after?.revision).toBe(before.revision);
  });

  test("account.password change increments user.revision", async () => {
    const accountId = "test-revision-account";
    await db.delete(account).where(eq(account.id, accountId));
    await db.insert(account).values({
      id: accountId,
      accountId: "credential",
      providerId: "credential",
      userId: testUserId,
      password: "old-hash",
    });
    const before = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    if (!before) throw new Error("user not found");

    await db.update(account).set({ password: "new-hash" }).where(eq(account.id, accountId));

    const after = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    expect(after?.revision).toBe(before.revision + 1);

    await db.delete(account).where(eq(account.id, accountId));
  });

  test("[MECE C3] concurrent UPDATE bumps revision by 2 (Postgres row-level lock)", async () => {
    const before = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    if (!before) throw new Error("user not found");
    await Promise.all([
      db.update(user).set({ name: "concurrent-A" }).where(eq(user.id, testUserId)),
      db
        .update(user)
        .set({ email: `concurrent-${Date.now()}@example.com` })
        .where(eq(user.id, testUserId)),
    ]);
    const after = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    expect(after?.revision).toBe(before.revision + 2);
  });

  test("[MECE N3] OAuth access_token UPDATE does NOT bump user.revision", async () => {
    const accountId = "test-oauth-account";
    await db.delete(account).where(eq(account.id, accountId));
    await db.insert(account).values({
      id: accountId,
      accountId: "github-user",
      providerId: "github",
      userId: testUserId,
      accessToken: "old-token",
      refreshToken: "old-refresh",
      password: null,
    });
    const before = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    if (!before) throw new Error("user not found");

    await db
      .update(account)
      .set({ accessToken: "new-token", refreshToken: "new-refresh" })
      .where(eq(account.id, accountId));

    const after = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    expect(after?.revision).toBe(before.revision);

    await db.delete(account).where(eq(account.id, accountId));
  });

  test("[MECE I4] account INSERT does NOT bump user.revision", async () => {
    const before = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    if (!before) throw new Error("user not found");

    const accountId = "test-insert-no-bump";
    await db.delete(account).where(eq(account.id, accountId));
    await db.insert(account).values({
      id: accountId,
      accountId: "credential",
      providerId: "credential",
      userId: testUserId,
      password: "fresh-hash",
    });
    const after = (await db.select().from(user).where(eq(user.id, testUserId)).limit(1))[0];
    expect(after?.revision).toBe(before.revision);

    await db.delete(account).where(eq(account.id, accountId));
  });
});
