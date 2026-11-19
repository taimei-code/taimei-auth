import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { IdGenerator } from "../id-generator";
import { readOwnedMfaStatus } from "../mfa/totp";
import { TtlStore } from "../ttl-store-service";
import { ownKey } from "../ttl-key";
import { PasskeyAlreadyRegistered, TotpRequired } from "./errors";
import type { RegistrationResponse } from "./passkey-contract";
import { PasskeyRepo } from "./ports";
import {
  hasIssuedChallengeShape,
  CHALLENGE_TTL_SECONDS,
  registrationOptions,
  verifyRegistration,
} from "./webauthn";

const challengeKey = (challenge: string) => ownKey("passkey:registration-challenge", challenge);

export const issueRegistrationOptions = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
) {
  if ((yield* readOwnedMfaStatus(actor)).enabled) return yield* new TotpRequired();
  const registered = yield* PasskeyRepo.use((repo) => repo.listPasskeys(actor.id));
  const options = yield* registrationOptions({
    userId: actor.id,
    email: actor.email,
    excludeCredentials: registered,
  });
  yield* TtlStore.use((store) =>
    store.set(challengeKey(options.challenge), actor.id, CHALLENGE_TTL_SECONDS),
  );
  return options;
});

const takeChallengeIssuedTo = (actor: Pick<Actor, "id">) => (challenge: string) =>
  hasIssuedChallengeShape(challenge)
    ? TtlStore.use((store) => store.getAndDelete(challengeKey(challenge))).pipe(
        Effect.map((owner) => owner === actor.id),
      )
    : Effect.succeed(false);

export const registerPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id">,
  response: RegistrationResponse,
) {
  const verified = yield* verifyRegistration({
    response,
    matchesChallenge: takeChallengeIssuedTo(actor),
  });
  const id = (yield* IdGenerator).passkeyId();
  const saved = yield* PasskeyRepo.use((repo) =>
    repo.insertPasskey({
      id,
      userId: actor.id,
      credentialId: verified.id,
      publicKey: verified.publicKey,
      counter: verified.counter,
      aaguid: verified.aaguid,
      transports: verified.transports,
    }),
  );
  if (saved === undefined) return yield* new PasskeyAlreadyRegistered();
});
