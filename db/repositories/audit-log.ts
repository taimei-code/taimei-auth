import { randomUUID } from "node:crypto";
import { db } from "../client";
import { auditLog } from "../schema";
import type { DbOrTx } from "../transaction";

// user の意図ある action のみを記録する (session revoke 等の internal state change は記録対象外)。
// IP / userAgent は session cascade delete でも forensic 可能にするため payload に persist。
// 詳細: CONTEXT.md 'audit log' / 'audit event'
export type AuditLogEntry =
  | {
      eventType: "sign_in";
      userId: string;
      payload: { method: "magic_link" | "github"; ip: string; userAgent: string };
    }
  | {
      eventType: "sign_out";
      userId: string;
      payload: { ip: string; userAgent: string };
    }
  | {
      eventType: "account_delete";
      userId: string;
      payload: Record<string, never>;
    };

export async function appendAuditLog(entry: AuditLogEntry, txOrDb: DbOrTx = db): Promise<void> {
  await txOrDb.insert(auditLog).values({
    id: randomUUID(),
    eventType: entry.eventType,
    userId: entry.userId,
    payload: entry.payload,
  });
}
