import { Effect } from "effect";
import type { PasskeySavingRefusal } from "@/db/repositories/passkey";
import type { Actor } from "../account/actor-contract";
import { appendAuditBestEffort, passkeyEntry } from "../audit/append";
import { IdGenerator } from "../id-generator";
import { PasskeyAlreadyRegistered, PasskeyLimitReached } from "./errors";
import type { RegistrationResponse } from "./passkey-contract";
import { notifyPasskeyChanged } from "./notify-passkey-change";
import { isPasskeyLimitReached } from "./policy";
import { PasskeyRepo } from "./ports";
import { registrationOptions, verifyRegistration } from "./webauthn";

export const issueRegistrationOptions = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
) {
  const owned = yield* PasskeyRepo.use((repo) => repo.listPasskeys(actor.id));
  if (isPasskeyLimitReached(owned.length)) return yield* new PasskeyLimitReached();
  return yield* registrationOptions({ userId: actor.id, email: actor.email });
});

const FAILURE_BY_SAVING_REFUSAL = {
  CredentialTaken: PasskeyAlreadyRegistered,
  LimitReached: PasskeyLimitReached,
} satisfies Record<PasskeySavingRefusal, unknown>;

export const registerPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
  response: RegistrationResponse,
  headers: Headers,
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
  yield* appendAuditBestEffort(passkeyEntry("passkey_registered", actor.id, saved, headers));
  yield* notifyPasskeyChanged({ change: "registered", email: actor.email, aaguid: saved.aaguid });
});
