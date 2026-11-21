import { Effect } from "effect";
import type { PasskeySavingRefusal } from "@/db/repositories/passkey";
import type { Actor } from "../account/actor-contract";
import { IdGenerator } from "../id-generator";
import { resetDisableAttempts, spendDisableAttempt } from "../mfa/disable-attempt-budget";
import { readOwnedMfaStatus } from "../mfa/totp";
import { consumeMatchedCode, matchOwnedCode } from "../mfa/totp/verify-code";
import { PasskeyAlreadyRegistered, PasskeyLimitReached, TotpRequired } from "./errors";
import type { RegistrationResponse } from "./passkey-contract";
import { isPasskeyLimitReached } from "./policy";
import { PasskeyRepo } from "./ports";
import { registrationOptions, verifyRegistration } from "./webauthn";

const confirmTotp = Effect.fnUntraced(function* (userId: string, totpCode: string | undefined) {
  if (totpCode === undefined) return yield* new TotpRequired();
  yield* spendDisableAttempt(userId);
  const matched = yield* matchOwnedCode(userId, { code: totpCode, kind: "totp" });
  yield* consumeMatchedCode(userId, matched);
  yield* resetDisableAttempts(userId);
});

export const issueRegistrationOptions = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
  totpCode: string | undefined,
) {
  const owned = yield* PasskeyRepo.use((repo) => repo.listPasskeys(actor.id));
  if (isPasskeyLimitReached(owned.length)) return yield* new PasskeyLimitReached();
  if ((yield* readOwnedMfaStatus(actor)).enabled) yield* confirmTotp(actor.id, totpCode);
  return yield* registrationOptions({ userId: actor.id, email: actor.email });
});

const FAILURE_BY_SAVING_REFUSAL = {
  CredentialTaken: PasskeyAlreadyRegistered,
  LimitReached: PasskeyLimitReached,
} satisfies Record<PasskeySavingRefusal, unknown>;

export const registerPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id">,
  response: RegistrationResponse,
) {
  const verified = yield* verifyRegistration({ userId: actor.id, response });
  const id = (yield* IdGenerator).passkeyId();
  const saved = yield* PasskeyRepo.use((repo) =>
    repo.insertPasskey({
      id,
      userId: actor.id,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      aaguid: verified.aaguid,
      transports: verified.transports,
    }),
  );
  if (typeof saved === "string") return yield* new FAILURE_BY_SAVING_REFUSAL[saved]();
});
