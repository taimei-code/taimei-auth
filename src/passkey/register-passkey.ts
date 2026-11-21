import { Effect } from "effect";
import type { PasskeySavingRefusal } from "@/db/repositories/passkey";
import type { Actor } from "../account/actor-contract";
import { IdGenerator } from "../id-generator";
import { readOwnedMfaStatus } from "../mfa/totp";
import { PasskeyAlreadyRegistered, PasskeyLimitReached, TotpRequired } from "./errors";
import type { RegistrationResponse } from "./passkey-contract";
import { isPasskeyLimitReached } from "./policy";
import { PasskeyRepo } from "./ports";
import { registrationOptions, verifyRegistration } from "./webauthn";

export const issueRegistrationOptions = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
) {
  const owned = yield* PasskeyRepo.use((repo) => repo.listPasskeys(actor.id));
  if (isPasskeyLimitReached(owned.length)) return yield* new PasskeyLimitReached();
  if ((yield* readOwnedMfaStatus(actor)).enabled) return yield* new TotpRequired();
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
