import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";

export const mfaChallengeRequired = Effect.fnUntraced(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  return isMfaEnabled(yield* mfa.readMfaVerification(userId));
});
