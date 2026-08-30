import { and, asc, count, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../client";
import { mfaRecoveryCode, mfaTotp } from "../schema";
import type { DbOrTx } from "../transaction";

// 自前 MFA テーブルへの唯一の入口。better-auth は複製しないため repository 直書きで良い
// (db/CLAUDE.md ルール 2 の Session/User 例外の対象外)。全関数は条件付き単文 (または素の CRUD) で、
// 並行決着は WHERE 句が担う — 行の解釈 (enabled 等) はここに置かない (use-case 側の policy が所有)。

export type MfaTotpRow = typeof mfaTotp.$inferSelect;

// 採番の正本。リカバリーコード id の "NN-<uuid>" は先頭 2 桁 = 挿入順 (id 昇順読み出しが再表示順)。
export const generateEnrollmentId = (): string => crypto.randomUUID();
export const generateRecoveryCodeId = (index: number): string =>
  `${String(index).padStart(2, "0")}-${crypto.randomUUID()}`;

// secret 列を含む全射影。復号は use-case の cipher が行い、平文はプロセス境界を越えない。
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

// チャレンジ要否判定用の最小射影。ログイン hot path の +1 SELECT はこれだけを使い secret 列に触れない。
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

// 状態表示用の 1 文読み (行 + 未使用コード数)。status 参照は rate limit 対象外で呼ばれやすく、
// 2 往復にしない。secret 列には触れない。
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

// INSERT ... ON CONFLICT DO NOTHING。true = 挿入できた (並行 enroll の勝者)。
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

// 識別子照合 + verified 化 + timestep 消費が 1 文に同居する。true = 勝者ちょうど 1。
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

// リプレイ・並行の決着点。last_used_timestep < $2 の単調比較で同一 timestep の 2 回目と過去コードを拒む。
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

// used_at IS NULL のみ、id 昇順 (= 挿入順) で返す。再表示順の固定は id 形式が担う (schema コメント)。
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

// 単回消費の決着点。used_at IS NULL の条件付き単文 UPDATE で並行消費の勝者をちょうど 1 にする。
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
