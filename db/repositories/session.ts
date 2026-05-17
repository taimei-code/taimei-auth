import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { session } from "../schema";
import type { DbOrTx } from "../transaction";

// revoked_at は better-auth 非管理列のため repository を経由する (db/CLAUDE.md ルール 1/2)。

// AND revoked_at IS NULL で 2 回目 revoke が 1 回目の時刻を上書きしない (forensic 時刻精度保証)。
export async function revokeAllSessionsForUser(userId: string, txOrDb: DbOrTx = db): Promise<void> {
  await txOrDb
    .update(session)
    .set({ revokedAt: sql`NOW()` })
    .where(and(eq(session.userId, userId), isNull(session.revokedAt)));
}

export async function findSessionRevokedAt(
  sessionId: string,
  txOrDb: DbOrTx = db,
): Promise<Date | null> {
  const row = await txOrDb
    .select({ revokedAt: session.revokedAt })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1)
    .then((rows) => rows.at(0));
  return row?.revokedAt ?? null;
}
