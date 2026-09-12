import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";

// ログイン境界の +1 SELECT は PK 引き 1 行・secret 列に触れない射影に限る。
export const mfaChallengeRequired = Effect.fn("mfa.challengeRequired")(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  return isMfaEnabled(yield* mfa.readMfaVerification(userId));
});
