import { Effect } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import type { DbError } from "../errors";
import { SentryService } from "../sentry";
import { AuditLog } from "./ports";

// best-effort 記帳 (CONTEXT.md) の失敗側: DbError を Sentry に集約し E channel から落とす
// (旧 src/audit-error.ts の captureAuditLogError の Effect 版)。直接 pipe するのは record* helper 経由の
// 記帳 (現状 invitation accept の拒否記録) だけ。entry を手で組む記帳は appendAuditLogBestEffort を使う
// (Sentry tag の event を entry から取り、tag と entry のずれを構造で防ぐ)。
export const swallowAuditFailure =
  (event: AuditLogEntry["eventType"]) =>
  <A, R>(
    program: Effect.Effect<A, DbError, R>,
  ): Effect.Effect<A | undefined, never, R | SentryService> =>
    program.pipe(
      Effect.catch((failure) =>
        Effect.gen(function* () {
          const sentry = yield* SentryService;
          yield* sentry.captureException(failure.cause, {
            tags: { component: "audit-log", event },
          });
          return undefined;
        }),
      ),
    );

// best-effort 記帳 (CONTEXT.md)。Sentry tag の event は entry から取る。
export const appendAuditLogBestEffort = (entry: AuditLogEntry) =>
  AuditLog.use((audit) => audit.appendAuditLog(entry)).pipe(swallowAuditFailure(entry.eventType));
