import { Clock, Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { AlreadyEnabled, EnrollmentChanged, InvalidCode, MfaNotFound } from "../error-mapping";
import { isMfaEnabled } from "../policy";
import type { MfaTotpActor, TotpSessionChanges } from "./contracts";
import { decryptValue, secretCipher } from "./cipher";
import { MfaKeyring, MfaNotifier, MfaSessions, MfaTotpRepo } from "./ports";
import { matchTotpCode } from "./totp-engine";

// revoke を確定 UPDATE より先に置くのは、逆順だと有効化済みなのに他 session が残る窓が開くため。
export const activate = Effect.fn("mfa.activate")(function* (input: {
  actor: MfaTotpActor;
  headers: Headers;
  enrollmentId: string;
  code: string;
}) {
  const mfa = yield* MfaTotpRepo;
  const row = yield* mfa.findMfaTotp(input.actor.id);
  if (!row) return yield* new MfaNotFound();
  if (isMfaEnabled(row)) return yield* new AlreadyEnabled();
  if (input.enrollmentId !== row.enrollmentId) return yield* new EnrollmentChanged();

  const ring = yield* MfaKeyring.use((k) => k.ring);
  const secret = yield* Effect.promise(() => decryptValue(ring, secretCipher(row), input.actor.id));
  const timestep = matchTotpCode(secret, input.code, yield* Clock.currentTimeMillis);
  if (timestep === null) return yield* new InvalidCode();

  const sessions = yield* MfaSessions;
  const sessionChanges = yield* sessions.revokeOthers(input.headers);

  // false = 並行敗者 (勝者が verified 化済み)。
  if (!(yield* mfa.activateMfaTotp(input.actor.id, row.enrollmentId, timestep))) {
    return yield* new AlreadyEnabled();
  }

  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditLogBestEffort({
    eventType: "mfa_enabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* MfaNotifier.use((n) => n.notifyEnabled(input.actor.email));
  return { sessionChanges } satisfies TotpSessionChanges;
});
