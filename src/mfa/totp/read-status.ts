import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";
import type { Actor } from "../../account/actor-contract";

export const readOwnedMfaStatus = Effect.fnUntraced(function* (actor: Pick<Actor, "id" | "email">) {
  const mfa = yield* MfaTotpRepo;
  const row = yield* mfa.readMfaStatusRow(actor.id);
  const enabled = isMfaEnabled(row);
  return {
    enabled,
    recoveryCodesRemaining: enabled ? row.unusedRecoveryCodes : 0,
  };
});
