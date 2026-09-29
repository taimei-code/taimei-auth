import { Effect, Layer } from "effect";
import { AuditLog } from "../../audit/ports";
import { EmailSender } from "../../email/ports";
import { DbError } from "../../errors";
import { partial } from "../../__tests__/live-runner";
import { MfaSessions } from "../totp/ports";

export const sessionsLayer = (recorded: { revokes: Headers[] }): Layer.Layer<MfaSessions> =>
  Layer.succeed(
    MfaSessions,
    partial<MfaSessions["Service"]>({
      revokeOthers: (headers) =>
        Effect.sync(() => {
          recorded.revokes.push(headers);
          const stub = new Headers();
          stub.append("set-cookie", "revoked=stub");
          return stub;
        }),
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
