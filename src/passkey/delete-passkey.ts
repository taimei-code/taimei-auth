import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { appendAuditBestEffort, passkeyEntry } from "../audit/append";
import { orNotFound } from "../failures";
import { PasskeyRepo } from "./ports";

export const deleteOwnedPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id">,
  passkeyId: string,
  headers: Headers,
) {
  const deleted = yield* PasskeyRepo.use((repo) => repo.deletePasskey(passkeyId, actor.id)).pipe(
    orNotFound,
  );
  yield* appendAuditBestEffort(passkeyEntry("passkey_deleted", actor.id, deleted, headers));
});
