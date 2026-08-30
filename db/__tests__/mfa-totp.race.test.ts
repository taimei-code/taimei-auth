import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { like } from "drizzle-orm";
import { db } from "../client";
import {
  activateMfaTotp,
  consumeRecoveryCode,
  consumeTotpTimestep,
  findMfaTotp,
  insertMfaTotpEnrollment,
  insertRecoveryCodes,
  listUnusedRecoveryCodes,
} from "../repositories/mfa-totp";
import { mfaRecoveryCode, mfaTotp, user } from "../schema";

// 並行決着が「操作文そのもの」で確定することの実証 (ADR-0016 §3.3)。勝者はちょうど 1。
// 暗号列は repository にとって不透明なので固定値でよい (復号は use-case の担当)。

const P = "mfa-race-";

const opaque = { secretCiphertext: "ct", secretIv: "iv", keyVersion: 1 };

const seedUser = async (suffix: string): Promise<string> => {
  const id = `${P}u-${suffix}`;
  await db.insert(user).values({
    id,
    name: `Race ${suffix}`,
    email: `${P}${suffix}@example.com`,
    emailVerified: true,
  });
  return id;
};

const cleanup = async (): Promise<void> => {
  await db.delete(mfaRecoveryCode).where(like(mfaRecoveryCode.userId, `${P}%`));
  await db.delete(mfaTotp).where(like(mfaTotp.userId, `${P}%`));
  await db.delete(user).where(like(user.id, `${P}%`));
};

const enrollmentOf = (userId: string, enrollmentId: string) => ({
  userId,
  enrollmentId,
  ...opaque,
});

const codeRow = (userId: string, index: number) => ({
  id: `${String(index).padStart(2, "0")}-${crypto.randomUUID()}`,
  userId,
  codeCiphertext: `code-ct-${index}`,
  codeIv: "iv",
  keyVersion: 1,
});

describe("mfa_totp repository の並行決着", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("AC-156 並行 insert ×2 → 勝者 1、行は勝者の enrollment_id", async () => {
    const userId = await seedUser("insert");

    const results = await Promise.all([
      insertMfaTotpEnrollment(enrollmentOf(userId, "enroll-a")),
      insertMfaTotpEnrollment(enrollmentOf(userId, "enroll-b")),
    ]);

    expect(results.filter(Boolean).length).toBe(1);
    const winner = results[0] ? "enroll-a" : "enroll-b";
    expect((await findMfaTotp(userId))?.enrollmentId).toBe(winner);
  });

  test("AC-113 並行 activate ×2 → 勝者 1、last_used_timestep は勝者の値", async () => {
    const userId = await seedUser("activate");
    await insertMfaTotpEnrollment(enrollmentOf(userId, "e-1"));

    const results = await Promise.all([
      activateMfaTotp(userId, "e-1", 101),
      activateMfaTotp(userId, "e-1", 102),
    ]);

    expect(results.filter(Boolean).length).toBe(1);
    const row = await findMfaTotp(userId);
    expect(row?.verifiedAt).not.toBeNull();
    expect(row?.lastUsedTimestep).toBe(results[0] ? 101 : 102);
  });

  test("識別子不一致の activate は false", async () => {
    const userId = await seedUser("mismatch");
    await insertMfaTotpEnrollment(enrollmentOf(userId, "e-current"));

    expect(await activateMfaTotp(userId, "e-stale", 100)).toBe(false);
    expect((await findMfaTotp(userId))?.verifiedAt).toBeNull();
  });

  test("未 verified の consumeTotpTimestep は false", async () => {
    const userId = await seedUser("unverified");
    await insertMfaTotpEnrollment(enrollmentOf(userId, "e-1"));

    expect(await consumeTotpTimestep(userId, 200)).toBe(false);
  });

  test("AC-119/120 timestep は単調消費 — 再消費・過去・並行敗者は false", async () => {
    const userId = await seedUser("timestep");
    await insertMfaTotpEnrollment(enrollmentOf(userId, "e-1"));
    await activateMfaTotp(userId, "e-1", 100);

    expect(await consumeTotpTimestep(userId, 101)).toBe(true);
    expect(await consumeTotpTimestep(userId, 101)).toBe(false);
    expect(await consumeTotpTimestep(userId, 99)).toBe(false);

    const race = await Promise.all([
      consumeTotpTimestep(userId, 102),
      consumeTotpTimestep(userId, 102),
    ]);
    expect(race.filter(Boolean).length).toBe(1);
  });

  test("AC-121 リカバリーコードの並行消費 ×2 → 勝者 1、countUnused が減る", async () => {
    const userId = await seedUser("recovery");
    await insertMfaTotpEnrollment(enrollmentOf(userId, "e-1"));
    await activateMfaTotp(userId, "e-1", 100);
    await insertRecoveryCodes([codeRow(userId, 0), codeRow(userId, 1)]);
    const [first] = await listUnusedRecoveryCodes(userId);

    const race = await Promise.all([
      consumeRecoveryCode(userId, first.id),
      consumeRecoveryCode(userId, first.id),
    ]);

    expect(race.filter(Boolean).length).toBe(1);
    expect(await consumeRecoveryCode(userId, first.id)).toBe(false);
    expect((await listUnusedRecoveryCodes(userId)).length).toBe(1);
  });
});
