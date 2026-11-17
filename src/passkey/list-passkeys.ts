import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { PasskeyRepo } from "./ports";

export const listOwnedPasskeys = Effect.fnUntraced(function* (actor: Pick<Actor, "id">) {
  const rows = yield* PasskeyRepo.use((repo) => repo.listPasskeys(actor.id));
  return rows.map(({ id, createdAt, lastUsedAt }) => ({ id, createdAt, lastUsedAt }));
});
