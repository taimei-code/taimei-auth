import { Effect, Layer } from "effect";
import { AuditLog } from "../../audit/ports";
import { DbError } from "../../errors";
import { partial } from "../../__tests__/live-runner";
import { Locked } from "../error-mapping";
import { MfaDisableBudget, MfaIssuer, MfaNotifier, MfaSessions } from "../totp/ports";

export const issuerLayer = (appName: string): Layer.Layer<MfaIssuer> =>
  Layer.succeed(MfaIssuer, MfaIssuer.of({ appName: Effect.succeed(appName) }));

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

export const notifierLayer = (notified: string[]): Layer.Layer<MfaNotifier> =>
  Layer.succeed(
    MfaNotifier,
    MfaNotifier.of({
      notifyEnabled: (email) => Effect.sync(() => notified.push(`enabled:${email}`)),
      notifyDisabled: (email) => Effect.sync(() => notified.push(`disabled:${email}`)),
    }),
  );

export const disableBudgetLayer = (
  recorded: { spends: string[]; resets: string[] },
  locked = false,
): Layer.Layer<MfaDisableBudget> =>
  Layer.succeed(
    MfaDisableBudget,
    MfaDisableBudget.of({
      spend: (userId) =>
        Effect.suspend(() => {
          recorded.spends.push(userId);
          return locked ? Effect.fail(new Locked()) : Effect.void;
        }),
      reset: (userId) => Effect.sync(() => recorded.resets.push(userId)),
    }),
  );

export const auditFailingLayer = (cause: unknown): Layer.Layer<AuditLog> =>
  Layer.succeed(
    AuditLog,
    partial<AuditLog["Service"]>({
      appendAuditLog: () => Effect.fail(new DbError({ cause })),
    }),
  );
