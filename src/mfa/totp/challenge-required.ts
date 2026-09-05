import { Effect } from "effect";
import { requiresMfaChallenge } from "../policy";
import { MfaTotpRepo } from "./ports";

// ログイン境界の +1 SELECT の唯一の読み口 (D5)。PK 引き 1 行・secret 列に触れない射影に限る。
// 発火点は一次認証成功後の after-hook のみで、リクエスト毎ではない。
export const mfaChallengeRequired = Effect.fn("mfa.challengeRequired")(function* (userId: string) {
  const mfa = yield* MfaTotpRepo;
  return requiresMfaChallenge(yield* mfa.readMfaVerification(userId));
});

// better-auth の after-hook (src/auth-plugins/mfa-challenge.ts) は Promise / throw 契約 (ADR-0017 の物理境界)
// なので、ここが Effect と Promise の境界になる。失敗を reject のまま返すことで、hook 側の
// fail-closed (catch → challengeRequired = true) を保つ。
// runtime は関数内で動的 import する (auth.ts から静的に辿れる module の規則: src/CLAUDE.md「Effect様式」)。
export const readMfaChallengeRequired = async (userId: string): Promise<boolean> => {
  const { getRuntime } = await import("../../runtime");
  return getRuntime().runPromise(mfaChallengeRequired(userId));
};
