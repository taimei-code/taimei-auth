import { Effect } from "effect";
import type { Actor } from "../../account/actor-contract";
import { UserRepo } from "../../account/ports";
import { appendAuditBestEffort } from "../../audit/append";
import { getClientContext } from "../../request-context";
import { Transaction } from "../../transaction";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { NotEnabled } from "../errors";
import type { MfaCodeKind } from "../mfa-contract";
import { notifyMfaDisabled, notifyMfaDisabledForManagement } from "../notification-adapter";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";
import { revokeOtherSessionsOrUnauthorized } from "./revoke-other-sessions";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

const deleteEnrollment = Effect.fnUntraced(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  const tx = yield* Transaction;
  return yield* tx.run(
    Effect.fnUntraced(function* (t) {
      const rows = yield* mfa.deleteMfaTotp(userId, t);
      yield* mfa.deleteRecoveryCodesByUserId(userId, t);
      return rows;
    }),
  );
});

const disableEnrollment = Effect.fnUntraced(function* (
  userId: string,
  client: { readonly ip: string | null; readonly userAgent: string },
) {
  const deleted = yield* deleteEnrollment(userId);
  if (deleted > 0) {
    yield* appendAuditBestEffort({ eventType: "mfa_disabled", userId, payload: client });
  }
  return deleted;
});

export const disable = Effect.fnUntraced(function* (input: {
  actor: Pick<Actor, "id" | "email">;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}) {
  const mfa = yield* MfaTotpRepo;
  const enrollment = yield* mfa.readMfaVerification(input.actor.id);
  if (!isMfaEnabled(enrollment)) return yield* new NotEnabled();

  yield* spendDisableAttempt(input.actor.id);
  const matched = yield* matchOwnedCode(input.actor.id, { code: input.code, kind: input.kind });
  const sessionChanges = yield* revokeOtherSessionsOrUnauthorized(input.headers);
  yield* consumeMatchedCode(input.actor.id, matched);
  yield* resetDisableAttempts(input.actor.id);

  yield* disableEnrollment(input.actor.id, getClientContext(input.headers));
  yield* notifyMfaDisabled(input.actor.email);
  return { sessionChanges };
});

export type ForceDisableResult =
  | { ok: false; error: "not_found" }
  | { ok: true; changed: false }
  | { ok: true; changed: true; notified: boolean };

const MANAGEMENT_CLI_CLIENT = { ip: null, userAgent: "management/disable-user-mfa" } as const;

export const forceDisableMfa = Effect.fnUntraced(function* (userId: string) {
  const user = yield* UserRepo.use((users) => users.findUserById(userId));
  if (!user) return { ok: false, error: "not_found" } satisfies ForceDisableResult;
  const mfa = yield* MfaTotpRepo;
  if (!isMfaEnabled(yield* mfa.readMfaVerification(userId))) {
    yield* deleteEnrollment(userId);
    return { ok: true, changed: false } satisfies ForceDisableResult;
  }

  if ((yield* disableEnrollment(userId, MANAGEMENT_CLI_CLIENT)) === 0)
    return { ok: true, changed: false } satisfies ForceDisableResult;
  const notified = yield* notifyMfaDisabledForManagement(user.email);
  return { ok: true, changed: true, notified } satisfies ForceDisableResult;
});
