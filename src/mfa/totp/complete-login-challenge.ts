import { Effect } from "effect";
import { establishSignIn } from "../../establish-sign-in";
import { ChallengeExpired } from "../errors";
import type { MfaCodeKind } from "../mfa-contract";
import {
  consumeLoginChallenge,
  peekLoginChallenge,
  spendLoginChallengeAttempt,
} from "./login-challenge";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

export const completeLoginChallenge = Effect.fnUntraced(function* (
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
) {
  const challenge = yield* peekLoginChallenge(headers);
  if (!challenge) return yield* new ChallengeExpired();

  const rejectWrongCode = yield* spendLoginChallengeAttempt(challenge.challengeId);

  const matched = yield* matchOwnedCode(challenge.userId, input).pipe(
    Effect.catchTags({
      NotEnabled: () => new ChallengeExpired(),
      InvalidCode: rejectWrongCode,
    }),
  );
  const clearCookie = yield* consumeLoginChallenge(challenge.challengeId);
  yield* consumeMatchedCode(challenge.userId, matched);

  const signedIn = yield* establishSignIn(headers, challenge);

  for (const cookie of clearCookie.getSetCookie()) {
    signedIn.forwardedHeaders.append("set-cookie", cookie);
  }

  return signedIn;
});
