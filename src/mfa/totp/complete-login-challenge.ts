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

  // 上限到達はチャレンジ破棄 + invalid_code — SPA の「再照会して expired 表示」契約を保存する。
  const attempt = yield* spendLoginChallengeAttempt(challenge.challengeId);
  if (attempt === "unavailable") return yield* new Locked();
  if (attempt === "exhausted") {
    yield* destroyLoginChallenge(challenge.challengeId);
    return yield* new InvalidCode();
  }

  // コード消費をチャレンジ消費の後に置くのは、敗北時に再生成不能なリカバリーコードを焼かないため。
  const matched = yield* matchOwnedCode(challenge.userId, input).pipe(
    Effect.catchTag("NotEnabled", () => new ChallengeExpired()),
  );
  const clearCookie = yield* consumeLoginChallenge(challenge.challengeId);
  yield* consumeMatchedCode(challenge.userId, matched);

  // 巻き戻し不能点 — 失敗をそのまま伝播させる。成功扱いにすると session 無しの成功応答になる。
  const sessionHeaders = yield* MfaSessions.use((s) => s.issueSession(challenge.userId));

  const { ip, userAgent } = getClientContext(headers);
  yield* appendAuditLogBestEffort({
    eventType: "sign_in",
    userId: challenge.userId,
    payload: { method: challenge.method, ip, userAgent },
  });

  // append で積む — set だと後段が前段の Set-Cookie を落とす。
  for (const cookie of clearCookie.getSetCookie()) sessionHeaders.append("set-cookie", cookie);

  // 返す直前に検証する — AUTH_TRUSTED_ORIGINS は保存と取り出しの間に変わりうる。
  return {
    redirectUrl: yield* validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
