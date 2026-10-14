import { Clock, Effect } from "effect";
import { appendAuditBestEffort } from "../../audit/append";
import { getClientContext } from "../../request-context";
import { AlreadyEnabled, EnrollmentChanged, InvalidCode, MfaNotFound } from "../errors";
import { notifyMfaEnabled } from "../notification-adapter";
import { isMfaEnabled } from "../policy";
import { decryptValue, secretCipher } from "./cipher";
import { MfaKeyring, MfaTotpRepo } from "./ports";
import { revokeOtherSessionsOrUnauthorized } from "./revoke-other-sessions";
import { matchTotpCode } from "./totp-engine";
import type { Actor } from "../../account/actor-contract";

export const activate = Effect.fnUntraced(function* (input: {
  actor: Pick<Actor, "id" | "email">;
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

  const sessionChanges = yield* revokeOtherSessionsOrUnauthorized(input.headers);

  const wonConcurrentActivation = yield* mfa.activateMfaTotp(
    input.actor.id,
    row.enrollmentId,
    timestep,
  );
  if (!wonConcurrentActivation) return yield* new AlreadyEnabled();

  const { ip, userAgent } = getClientContext(input.headers);
  yield* appendAuditBestEffort({
    eventType: "mfa_enabled",
    userId: input.actor.id,
    payload: { ip, userAgent },
  });
  yield* notifyMfaEnabled(input.actor.email);
  return { sessionChanges };
});
