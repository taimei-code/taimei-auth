import { Effect, Layer } from "effect";
import { AuditLog } from "../../audit/ports";
import { AuthApi, type SessionRejected } from "../../auth-service";
import { EmailSender } from "../../email/ports";
import { type AuthApiError, DbError } from "../../errors";
import { partial } from "../../__tests__/live-runner";

export const revokeRecordingLayer = (
  recorded: { revokes: Headers[] },
  outcome: Effect.Effect<Headers, SessionRejected | AuthApiError> = Effect.sync(
    () => new Headers({ "set-cookie": "revoked=stub" }),
  ),
): Layer.Layer<AuthApi> =>
  Layer.succeed(
    AuthApi,
    partial<AuthApi["Service"]>({
      revokeOtherSessions: (headers) =>
        Effect.sync(() => recorded.revokes.push(headers)).pipe(Effect.andThen(outcome)),
    }),
  );

export const mfaMailRecorderLayer = (sent: string[]): Layer.Layer<EmailSender> =>
  Layer.succeed(
    EmailSender,
    partial<EmailSender["Service"]>({
      sendMfaEnabled: (email) => Effect.sync(() => sent.push(`enabled:${email}`)),
      sendMfaDisabled: (email) => Effect.sync(() => sent.push(`disabled:${email}`)),
    }),
  );

export const auditFailingLayer = (cause: unknown): Layer.Layer<AuditLog> =>
  Layer.succeed(
    AuditLog,
    partial<AuditLog["Service"]>({
      appendAuditLog: () => Effect.fail(new DbError({ cause })),
    }),
  );
