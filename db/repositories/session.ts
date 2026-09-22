import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { session } from "../schema";
import type { DbOrTx } from "../transaction";

// AND revoked_at IS NULL により、2 回目の revoke が 1 回目の時刻を上書きしない (調査時の時刻の正確さを保つ)。
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
