import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  mfaRegistrationGuardProtocol,
  mfaRegistrationTransitionGuard,
  twoFactor,
  user,
  type MfaRegistrationOperationKind,
} from "../schema";
import type { DbOrTx } from "../transaction";
import { recordMfaRegistrationGuardReleased } from "./audit-log";
import type { TwoFactorVerificationState } from "./two-factor";

export type { MfaRegistrationOperationKind as RegistrationOperationKind } from "../schema";

// 取得 transaction が読んだ user / two_factor の最新状態。use-case の前提条件判定は
// この snapshot だけを見る (ADR-0013 §8)。
export type RegistrationSnapshot =
  | { user: "absent" }
  | {
      user: "present";
      email: string;
      twoFactorEnabled: boolean;
      enrollment: TwoFactorVerificationState | undefined;
    };

export type GuardLease = {
  userId: string;
  token: string;
  operation: MfaRegistrationOperationKind;
  snapshot: RegistrationSnapshot;
};

// 取得失敗の cause は呼び出し側の分岐に効く: held (先行 guard が存在。heldSince は滞留検知の入力) /
// timeout・lock (競合打ち切り → busy) / user_absent (user 行が無い → 恒久条件。busy に倒すと
// 削除済みアカウントへ Retry-After を返し続ける)。
export type AcquireRegistrationGuardResult =
  | { acquired: true; lease: GuardLease }
  | { acquired: false; cause: "held"; heldSince: Date | undefined }
  | { acquired: false; cause: "timeout" | "lock" | "user_absent" };

// (flag, 行) の組は 1 statement で読む。READ COMMITTED では statement ごとに MVCC snapshot が
// 変わるため、分割すると guard 外 writer (ログインチャレンジの verifyTOTP / account deletion) と
// 交差した時に「どの時点にも存在しなかった組」を前提条件判定へ渡しうる。行の一意性は
// two_factor.user_id の UNIQUE が保証するので ORDER BY は不要 (読み側の決定化規則の正本:
// db/repositories/two-factor.ts)。テストの snapshot 組み立てもこの関数を共有し、production が
// 生成しない形の snapshot で前提条件マトリクスが緑になる drift を防ぐ。
export async function readRegistrationSnapshot(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<RegistrationSnapshot> {
  const rows = await txOrDb
    .select({
      email: user.email,
      twoFactorEnabled: user.twoFactorEnabled,
      enrollmentId: twoFactor.id,
      verified: twoFactor.verified,
    })
    .from(user)
    .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const row = rows.at(0);
  return row
    ? {
        user: "present",
        email: row.email,
        twoFactorEnabled: row.twoFactorEnabled,
        enrollment:
          row.enrollmentId === null
            ? undefined
            : { id: row.enrollmentId, verified: row.verified === true },
      }
    : { user: "absent" };
}

const REGISTRATION_GUARD_PROTOCOL_KEY = "mfa_registration_guard";

export async function readRegistrationGuardProtocolVersion(): Promise<number | undefined> {
  const rows = await db
    .select({ version: mfaRegistrationGuardProtocol.version })
    .from(mfaRegistrationGuardProtocol)
    .where(eq(mfaRegistrationGuardProtocol.protocolKey, REGISTRATION_GUARD_PROTOCOL_KEY))
    .limit(1);
  return rows.at(0)?.version;
}

export async function acquireRegistrationGuard(
  userId: string,
  operation: MfaRegistrationOperationKind,
): Promise<AcquireRegistrationGuardResult> {
  const token = randomUUID();
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('lock_timeout', '250ms', true), set_config('statement_timeout', '250ms', true)`,
      );
      const inserted = await tx
        .insert(mfaRegistrationTransitionGuard)
        .values({ userId, operationToken: token, operationKind: operation })
        .onConflictDoNothing()
        .returning({ userId: mfaRegistrationTransitionGuard.userId });
      if (inserted.length === 0) {
        const holders = await tx
          .select({ acquiredAt: mfaRegistrationTransitionGuard.acquiredAt })
          .from(mfaRegistrationTransitionGuard)
          .where(eq(mfaRegistrationTransitionGuard.userId, userId))
          .limit(1);
        return {
          acquired: false as const,
          cause: "held" as const,
          heldSince: holders.at(0)?.acquiredAt,
        };
      }
      const snapshot = await readRegistrationSnapshot(userId, tx);
      return { acquired: true as const, lease: { userId, token, operation, snapshot } };
    });
  } catch (error) {
    const cause = acquireFailureCause(error);
    if (cause) return { acquired: false, cause };
    throw error;
  }
}

export async function releaseRegistrationGuard(lease: GuardLease): Promise<{ released: boolean }> {
  const deleted = await db
    .delete(mfaRegistrationTransitionGuard)
    .where(
      and(
        eq(mfaRegistrationTransitionGuard.userId, lease.userId),
        eq(mfaRegistrationTransitionGuard.operationToken, lease.token),
      ),
    )
    .returning({ userId: mfaRegistrationTransitionGuard.userId });
  return { released: deleted.length === 1 };
}

export async function releaseRegistrationGuardByManagement(params: {
  userId: string;
  source: string;
  reason: string;
  // literal true を要求し、停止確認を経ない呼び出し元が「確認済み」の audit を書けない形にする。
  processStoppedConfirmed: true;
}): Promise<{ released: boolean }> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(mfaRegistrationTransitionGuard)
      .where(eq(mfaRegistrationTransitionGuard.userId, params.userId))
      .returning({ userId: mfaRegistrationTransitionGuard.userId });
    if (deleted.length === 0) return { released: false };
    await recordMfaRegistrationGuardReleased(
      {
        user_id: params.userId,
        source: params.source,
        reason: params.reason,
        process_stopped_confirmed: params.processStoppedConfirmed,
      },
      tx,
    );
    return { released: true };
  });
}

// drizzle-orm 0.45 は DB エラーを DrizzleQueryError でラップし、pg のエラーコードは cause 側に載る。
function pgErrorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (code !== undefined) return code;
  return typeof cause === "object" && cause !== null
    ? (cause as { code?: unknown }).code
    : undefined;
}

// 55P03 = lock_timeout / 57014 = statement_timeout (未 commit の競合 insert 待ちの打ち切り)。
// 23503 = user 行の FK 違反 = guard 取得と user 削除の race。恒久条件なので busy と区別して返す。
function acquireFailureCause(error: unknown): "timeout" | "lock" | "user_absent" | undefined {
  switch (pgErrorCode(error)) {
    case "55P03":
      return "lock";
    case "57014":
      return "timeout";
    case "23503":
      return "user_absent";
    default:
      return undefined;
  }
}
