import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";

// ログイン hot path の SELECT は PK 1 行・secret 列に触れない射影に限る。
export const mfaChallengeRequired = Effect.fn("mfa.challengeRequired")(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  return isMfaEnabled(yield* mfa.readMfaVerification(userId));
});
