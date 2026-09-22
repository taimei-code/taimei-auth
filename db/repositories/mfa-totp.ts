import { and, asc, count, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../client";
import { mfaRecoveryCode, mfaTotp } from "../schema";
import type { DbOrTx } from "../transaction";

// 全関数を条件付きの単一 statement にし、並行時の決着は WHERE 句に任せる (行の解釈は use-case 側で行う)。

export type MfaTotpRow = typeof mfaTotp.$inferSelect;

export const generateEnrollmentId = (): string => crypto.randomUUID();
export const generateRecoveryCodeId = (index: number): string =>
  `${String(index).padStart(2, "0")}-${crypto.randomUUID()}`;

// 復号は use-case 側の cipher が行い、平文はプロセスの境界を越えない。
export async function findMfaTotp(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<MfaTotpRow | undefined> {
  return txOrDb
    .select()
    .from(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function readMfaVerification(
  userId: string,
): Promise<{ verifiedAt: Date | null } | undefined> {
  return db
    .select({ verifiedAt: mfaTotp.verifiedAt })
    .from(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function readMfaStatusRow(
  userId: string,
): Promise<{ verifiedAt: Date | null; unusedRecoveryCodes: number } | undefined> {
  return db
    .select({ verifiedAt: mfaTotp.verifiedAt, unusedRecoveryCodes: count(mfaRecoveryCode.id) })
    .from(mfaTotp)
    .leftJoin(
      mfaRecoveryCode,
      and(eq(mfaRecoveryCode.userId, mfaTotp.userId), isNull(mfaRecoveryCode.usedAt)),
    )
    .where(eq(mfaTotp.userId, userId))
    .groupBy(mfaTotp.userId, mfaTotp.verifiedAt)
    .then((rows) => rows.at(0));
}

export type NewMfaTotpEnrollment = {
  userId: string;
  enrollmentId: string;
  secretCiphertext: string;
  secretIv: string;
  keyVersion: number;
};

export async function insertMfaTotpEnrollment(
  values: NewMfaTotpEnrollment,
  txOrDb: DbOrTx = db,
): Promise<boolean> {
  return txOrDb
    .insert(mfaTotp)
    .values(values)
    .onConflictDoNothing()
    .returning({ userId: mfaTotp.userId })
    .then((rows) => rows.length === 1);
}

export async function activateMfaTotp(
  userId: string,
  enrollmentId: string,
  usedTimestep: number,
): Promise<boolean> {
  return db
    .update(mfaTotp)
    .set({ verifiedAt: new Date(), lastUsedTimestep: usedTimestep })
    .where(
      and(
        eq(mfaTotp.userId, userId),
        eq(mfaTotp.enrollmentId, enrollmentId),
        isNull(mfaTotp.verifiedAt),
      ),
    )
    .returning({ userId: mfaTotp.userId })
    .then((rows) => rows.length === 1);
}

// last_used_timestep との単調比較で、同じ timestep の 2 回目と過去のコードを拒否する。
export async function consumeTotpTimestep(userId: string, timestep: number): Promise<boolean> {
  return db
    .update(mfaTotp)
    .set({ lastUsedTimestep: timestep })
    .where(
      and(
        eq(mfaTotp.userId, userId),
        isNotNull(mfaTotp.verifiedAt),
        lt(mfaTotp.lastUsedTimestep, timestep),
      ),
    )
    .returning({ userId: mfaTotp.userId })
    .then((rows) => rows.length === 1);
}

export async function deleteMfaTotp(userId: string, txOrDb: DbOrTx = db): Promise<number> {
  return txOrDb
    .delete(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .returning({ userId: mfaTotp.userId })
    .then((rows) => rows.length);
}

export type NewMfaRecoveryCode = {
  id: string;
  userId: string;
  codeCiphertext: string;
  codeIv: string;
  keyVersion: number;
};

export async function insertRecoveryCodes(
  values: NewMfaRecoveryCode[],
  txOrDb: DbOrTx = db,
): Promise<void> {
  if (values.length === 0) return;
  await txOrDb.insert(mfaRecoveryCode).values(values);
}

export type UnusedRecoveryCode = {
  id: string;
  codeCiphertext: string;
  codeIv: string;
  keyVersion: number;
};

export async function listUnusedRecoveryCodes(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<UnusedRecoveryCode[]> {
  return txOrDb
    .select({
      id: mfaRecoveryCode.id,
      codeCiphertext: mfaRecoveryCode.codeCiphertext,
      codeIv: mfaRecoveryCode.codeIv,
      keyVersion: mfaRecoveryCode.keyVersion,
    })
    .from(mfaRecoveryCode)
    .where(and(eq(mfaRecoveryCode.userId, userId), isNull(mfaRecoveryCode.usedAt)))
    .orderBy(asc(mfaRecoveryCode.id));
}

export async function consumeRecoveryCode(userId: string, id: string): Promise<boolean> {
  return db
    .update(mfaRecoveryCode)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCode.id, id),
        eq(mfaRecoveryCode.userId, userId),
        isNull(mfaRecoveryCode.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCode.id })
    .then((rows) => rows.length === 1);
}

export async function deleteRecoveryCodesByUserId(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<number> {
  return txOrDb
    .delete(mfaRecoveryCode)
    .where(eq(mfaRecoveryCode.userId, userId))
    .returning({ id: mfaRecoveryCode.id })
    .then((rows) => rows.length);
}
