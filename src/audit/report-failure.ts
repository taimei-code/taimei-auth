import { Effect } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import type { DbError } from "../errors";
import { captureCause, type SentryService } from "../sentry";
import { AuditLog } from "./ports";

export const swallowAuditFailure =
  (event: AuditLogEntry["eventType"]) =>
  <R>(program: Effect.Effect<unknown, DbError, R>): Effect.Effect<void, never, R | SentryService> =>
    program.pipe(
      Effect.asVoid,
      Effect.catch(captureCause({ level: "error", tags: { component: "audit-log", event } })),
    );

export const appendAuditLogBestEffort = (entry: AuditLogEntry) =>
  AuditLog.use((audit) => audit.appendAuditLog(entry)).pipe(swallowAuditFailure(entry.eventType));
