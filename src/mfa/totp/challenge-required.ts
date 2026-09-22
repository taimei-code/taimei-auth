import { Effect } from "effect";
import { isMfaEnabled } from "../policy";
import { MfaTotpRepo } from "./ports";

// ログイン境界で増える 1 回の SELECT は、PK で 1 行を引き secret 列に触れない列指定に限る。
export const mfaChallengeRequired = Effect.fn("mfa.challengeRequired")(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  return isMfaEnabled(yield* mfa.readMfaVerification(userId));
});
