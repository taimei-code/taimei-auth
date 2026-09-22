import { Effect } from "effect";
import { appendAuditLogBestEffort } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { ChallengeExpired, InvalidCode, Locked } from "../error-mapping";
import { validateChallengeRedirect } from "../redirect-guard";
import type { MfaCodeKind } from "../client-facing-contracts";
import {
  consumeLoginChallenge,
  destroyLoginChallenge,
  peekLoginChallenge,
  spendLoginChallengeAttempt,
} from "./login-challenge";
import { MfaSessions } from "./ports";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

export const completeLoginChallenge = Effect.fn("mfa.completeLoginChallenge")(function* (
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
) {
  const challenge = yield* peekLoginChallenge(headers);
  if (!challenge) return yield* new ChallengeExpired();

  // 枯渇時は破棄して invalid_code のまま。SPA は再照会して expired を出す契約。
  const attempt = yield* spendLoginChallengeAttempt(challenge.challengeId);
  if (attempt === "unavailable") return yield* new Locked();
  if (attempt === "exhausted") {
    yield* destroyLoginChallenge(challenge.challengeId);
    return yield* new InvalidCode();
  }

  // コードの消費はチャレンジの消費より後。逆順だと並行して負けた側が再生成できないリカバリーコードを使い切る。
  const matched = yield* matchOwnedCode(challenge.userId, input).pipe(
    Effect.catchTag("NotEnabled", () => new ChallengeExpired()),
  );
  const clearCookie = yield* consumeLoginChallenge(challenge.challengeId);
  yield* consumeMatchedCode(challenge.userId, matched);

  // 失敗を握ると session の無い成功応答になる。
  const sessionHeaders = yield* MfaSessions.use((s) => s.issueSession(challenge.userId));

  const { ip, userAgent } = getClientContext(headers);
  yield* appendAuditLogBestEffort({
    eventType: "sign_in",
    userId: challenge.userId,
    payload: { method: challenge.method, ip, userAgent },
  });

  // set だと前段の Set-Cookie が消える。
  for (const cookie of clearCookie.getSetCookie()) sessionHeaders.append("set-cookie", cookie);

  // 保存時でなく返す直前に検証する。AUTH_TRUSTED_ORIGINS はその間に変わりうる。
  return {
    redirectUrl: yield* validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
