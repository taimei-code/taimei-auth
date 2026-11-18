import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { orNotFound } from "../failures";
import { PasskeyRepo } from "./ports";

export const deleteOwnedPasskey = Effect.fnUntraced(function* (
  actor: Pick<Actor, "id">,
  passkeyId: string,
) {
  yield* PasskeyRepo.use((repo) => repo.deletePasskey(passkeyId, actor.id)).pipe(orNotFound);
});
