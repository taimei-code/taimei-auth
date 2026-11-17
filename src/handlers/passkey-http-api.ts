import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { listOwnedPasskeys } from "../passkey/list-passkeys";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

export const PasskeyHandlers = HttpApiBuilder.group(SpaApi, "passkey", (handlers) =>
  handlers.handleAll({
    list: Effect.fnUntraced(function* () {
      const passkeys = yield* listOwnedPasskeys(yield* CurrentActor);
      return {
        passkeys: passkeys.map((passkey) => ({
          id: passkey.id,
          created_at: passkey.createdAt.toISOString(),
          last_used_at: passkey.lastUsedAt?.toISOString() ?? null,
        })),
      };
    }, dieOnBoundary),
  }),
);
