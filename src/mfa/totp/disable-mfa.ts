import { Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { Transaction } from "../../transaction";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { NotEnabled } from "../error-mapping";
import { notifyMfaDisabled } from "../notification-adapter";
import { isMfaEnabled } from "../policy";
import type { MfaCodeKind } from "../client-facing-contracts";
import type { MfaTotpActor, TotpSessionChanges } from "./contracts";
import { MfaTotpRepo } from "./ports";
import { revokeOtherSessionsOrUnauthorized } from "./revoke-other-sessions";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

export const disable = Effect.fn("mfa.disable")(function* (input: {
  actor: MfaTotpActor;
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

  const tx = yield* Transaction;
  yield* tx.run(
    Effect.fn("mfa.disable.apply")(function* (t) {
      yield* mfa.deleteMfaTotp(input.actor.id, t);
      yield* mfa.deleteRecoveryCodesByUserId(input.actor.id, t);
    }),
  );

  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditLogBestEffort({
    eventType: "mfa_disabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* notifyMfaDisabled(input.actor.email);
  return { sessionChanges } satisfies TotpSessionChanges;
});
