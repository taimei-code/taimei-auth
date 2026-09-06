import { Clock, Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { AlreadyEnabled, EnrollmentChanged, InvalidCode, MfaNotFound } from "../error-mapping";
import type { MfaTotpActor, TotpSessionChanges } from "./contracts";
import { decryptValue, secretCipher } from "./cipher";
import { MfaKeyring, MfaNotifier, MfaSessions, MfaTotpRepo } from "./ports";
import { matchTotpCode } from "./totp-engine";

// 有効化。検証順序が契約 (§4.3): 復号 + コード検証 → revoke → 確定 UPDATE。
// 誤コードは revoke より前で終わり他デバイスを失効させない。revoke を確定より先に置くのは、
// 逆順で revoke が失敗すると「有効化済みなのに他 session が残る」窓が開くため。session rotate は行わない。
export const activate = Effect.fn("mfa.activate")(function* (input: {
  actor: MfaTotpActor;
  headers: Headers;
  enrollmentId: string;
  code: string;
}) {
  const mfa = yield* MfaTotpRepo;
  const row = yield* mfa.findMfaTotp(input.actor.id);
  if (!row) return yield* new MfaNotFound();
  if (row.verifiedAt !== null) return yield* new AlreadyEnabled();
  if (input.enrollmentId !== row.enrollmentId) return yield* new EnrollmentChanged();

  const ring = yield* (yield* MfaKeyring).ring;
  const secret = yield* Effect.promise(() => decryptValue(ring, secretCipher(row), input.actor.id));
  const timestep = matchTotpCode(secret, input.code, yield* Clock.currentTimeMillis);
  if (timestep === null) return yield* new InvalidCode();

  const sessions = yield* MfaSessions;
  const sessionChanges = yield* sessions.revokeOthers(input.headers);

  // false = 並行敗者 (勝者が verified 化済み)。識別子はここで再照合されるため評決は already_enabled。
  if (!(yield* mfa.activateMfaTotp(input.actor.id, row.enrollmentId, timestep))) {
    return yield* new AlreadyEnabled();
  }

  // best-effort 記帳 (CONTEXT.md)。
  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditLogBestEffort({
    eventType: "mfa_enabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* (yield* MfaNotifier).notifyEnabled(input.actor.email);
  return { sessionChanges } satisfies TotpSessionChanges;
});
