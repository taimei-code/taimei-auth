import type { AuditLogEntry } from "@/db/repositories/audit-log";
import { Sentry } from "./sentry";

// audit log の append 失敗は sign-in / sign-out path を止めない (UX 優先)。長期障害検知のため Sentry に集約。
export function captureAuditLogError(event: AuditLogEntry["eventType"], error: unknown): void {
  Sentry.captureException(error, { tags: { component: "audit-log", event } });
}
