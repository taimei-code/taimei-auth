import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { IdGenerator } from "../id-generator";
import { readOwnedMfaStatus } from "../mfa/totp";
import { PasskeyAlreadyRegistered, TotpRequired } from "./errors";
import type { RegistrationResponse } from "./passkey-contract";
import { PasskeyRepo } from "./ports";
import { registrationOptions, verifyRegistration } from "./webauthn";

export const issueRegistrationOptions = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
) {
  if ((yield* readOwnedMfaStatus(actor)).enabled) return yield* new TotpRequired();
  return yield* registrationOptions({ userId: actor.id, email: actor.email });
});

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
  if (saved === undefined) return yield* new PasskeyAlreadyRegistered();
});
