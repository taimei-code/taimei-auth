import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import type { MfaTotpActor } from "./contracts";
import { MfaTotpRepo } from "./ports";

export const readOwnedMfaStatus = Effect.fn("mfa.readOwnedMfaStatus")(function* (
  actor: MfaTotpActor,
) {
  const mfa = yield* MfaTotpRepo;
  const row = yield* mfa.readMfaStatusRow(actor.id);
  const enabled = isMfaEnabled(row);
  return {
    enabled,
    recoveryCodesRemaining: enabled ? row.unusedRecoveryCodes : 0,
  };
});
