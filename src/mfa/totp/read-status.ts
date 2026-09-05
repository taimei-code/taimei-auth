import { Effect } from "effect";
import { requiresMfaChallenge } from "../policy";
import type { MfaTotpActor } from "./contracts";
import { MfaTotpRepo } from "./ports";

// 表示もチャレンジ要否と同じ述語を必ず通す (判定二重化の禁止: policy.ts)。
// wire の in_effect ≡ enabled の写像は handler が持つ (ADR-0016)。
export const readOwnedMfaStatus = Effect.fn("mfa.readOwnedMfaStatus")(function* (
  actor: MfaTotpActor,
) {
  const mfa = yield* MfaTotpRepo;
  const row = yield* mfa.readMfaStatusRow(actor.id);
  const enabled = requiresMfaChallenge(row);
  return {
    enabled,
    recoveryCodesRemaining: enabled && row ? row.unusedRecoveryCodes : 0,
  };
});
