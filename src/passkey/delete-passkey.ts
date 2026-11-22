import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { appendAuditBestEffort, passkeyEntry } from "../audit/append";
import { orNotFound } from "../failures";
import { notifyPasskeyChanged } from "./notify-passkey-change";
import { PasskeyRepo } from "./ports";

export const deleteOwnedPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id" | "email">,
  passkeyId: string,
  headers: Headers,
) {
  const deleted = yield* PasskeyRepo.use((repo) => repo.deletePasskey(passkeyId, actor.id)).pipe(
    orNotFound,
  );
  yield* appendAuditBestEffort(passkeyEntry("passkey_deleted", actor.id, deleted, headers));
  yield* notifyPasskeyChanged({ change: "deleted", email: actor.email, aaguid: deleted.aaguid });
});
