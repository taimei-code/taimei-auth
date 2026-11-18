import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { deleteOwnedPasskey } from "../passkey/delete-passkey";
import { listOwnedPasskeys } from "../passkey/list-passkeys";
import { issueRegistrationOptions, registerPasskey } from "../passkey/register-passkey";
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
    registrationOptions: Effect.fnUntraced(function* () {
      return yield* issueRegistrationOptions(yield* CurrentActor);
    }, dieOnBoundary),
    register: Effect.fnUntraced(function* ({ payload }) {
      yield* registerPasskey(yield* CurrentActor, payload);
      return { ok: true as const };
    }, dieOnBoundary),
    delete: Effect.fnUntraced(function* ({ params }) {
      yield* deleteOwnedPasskey(yield* CurrentActor, params.passkeyId);
      return { ok: true as const };
    }, dieOnBoundary),
  }),
);
