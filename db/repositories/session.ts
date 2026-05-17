import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { session } from "../schema";

// session repository は revoked_at という better-auth 非管理列を扱うため作成する。
// 既存 better-auth 管理列 (expires_at / token 等) の update は db/CLAUDE.md ルール 2 末尾により
// better-auth API 経由を強制する (cookieCache invalidate を lifecycle hook に委ねるため)。
// cookieCache 整合は VerifySession 側で都度 DB の revoked_at を確認することで担保 (user.revision と同パターン)。
//
// tx を optional 引数で受ける設計理由: deleteUser handler が db.transaction 内で revoke + delete を
// atomic 実行する必要がある。tx 省略時は外側 db で実行 (単体使用も可)。
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// idempotency: AND revoked_at IS NULL で 2 回目 revoke が 1 回目の時刻を上書きしない
// (forensic 時刻精度保証)。
export async function revokeAllSessionsForUser(userId: string, txOrDb: DbOrTx = db): Promise<void> {
  await txOrDb
    .update(session)
    .set({ revokedAt: sql`NOW()` })
    .where(and(eq(session.userId, userId), isNull(session.revokedAt)));
}

// 単純存在チェックではなく Date | null を返すことで、handler 側で `<= now()` の
// 即時 revoke / 予約 revoke (将来) を判定できる。
export async function findSessionRevokedAt(sessionId: string): Promise<Date | null> {
  const row = await db
    .select({ revokedAt: session.revokedAt })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1)
    .then((rows) => rows.at(0));
  return row?.revokedAt ?? null;
}
