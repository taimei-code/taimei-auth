import { Effect } from "effect";
import type { Actor } from "../account/actor-contract";
import { passkeyReleased } from "./availability";
import { PasskeyRepo } from "./ports";

export const listOwnedPasskeys = Effect.fnUntraced(function* (actor: Pick<Actor, "id">) {
  const { rows, canRegister } = yield* Effect.all(
    {
      rows: PasskeyRepo.use((repo) => repo.listPasskeys(actor.id)),
      canRegister: passkeyReleased(),
    },
    { concurrency: "unbounded" },
  );
  return {
    passkeys: rows.map(({ id, createdAt, lastUsedAt }) => ({ id, createdAt, lastUsedAt })),
    canRegister,
  };
});
