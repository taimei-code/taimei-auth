import { Effect, Layer } from "effect";
import { AuditLog } from "../../audit/ports";
import { DbError } from "../../errors";
import { partial } from "../../__tests__/live-runner";
import { Locked } from "../error-mapping";
import { MfaDisableBudget, MfaIssuer, MfaNotifier, MfaSessions } from "../totp/ports";

// MFA の use-case テスト用 test Layer (design §3.14)。runner は live-runner.ts の runTest を使う。

export const issuerLayer = (appName: string): Layer.Layer<MfaIssuer> =>
  Layer.succeed(MfaIssuer, MfaIssuer.of({ appName: Effect.succeed(appName) }));

// revoke は他デバイス失効の観測点。呼び出し有無と回数が検証対象なので記録して stub cookie を返す。
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

// audit 書込失敗 (DbError) を注入する。記帳の best-effort 性 (操作は成立する) の検証用。
export const auditFailingLayer = (cause: unknown): Layer.Layer<AuditLog> =>
  Layer.succeed(
    AuditLog,
    partial<AuditLog["Service"]>({
      recordMfaEnabled: () => Effect.fail(new DbError({ cause })),
      recordMfaDisabled: () => Effect.fail(new DbError({ cause })),
      appendAuditLog: () => Effect.fail(new DbError({ cause })),
    }),
  );
