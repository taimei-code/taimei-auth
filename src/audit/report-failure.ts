import { Effect } from "effect";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import type { DbError } from "../errors";
import { SentryService } from "../sentry";

// audit log の append 失敗は sign-in / sign-out / MFA path を止めない (UX 優先)。長期障害検知のため
// Sentry に集約し、E channel からは落とす (旧 src/audit-error.ts の captureAuditLogError の Effect 版)。
// 使い方: `yield* audit.recordSignIn(...).pipe(swallowAuditFailure("sign_in"))`
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
