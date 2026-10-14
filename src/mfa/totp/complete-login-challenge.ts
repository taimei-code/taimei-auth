import { Effect } from "effect";
import { appendAuditBestEffort, signInEntry } from "../../audit/append";
import { AuthApi } from "../../auth-service";
import { ChallengeExpired } from "../errors";
import { validateChallengeRedirect } from "../redirect-guard";
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

  const sessionHeaders = yield* AuthApi.use((authApi) => authApi.issueSession(challenge.userId));

  yield* appendAuditBestEffort(signInEntry(challenge.userId, challenge.method, headers));

  for (const cookie of clearCookie.getSetCookie()) sessionHeaders.append("set-cookie", cookie);

  return {
    redirectUrl: yield* validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
