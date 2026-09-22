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

  // 上限に達したらチャレンジを破棄して invalid_code を返し、SPA の「再照会して expired を表示する」契約を保つ。
  const attempt = yield* spendLoginChallengeAttempt(challenge.challengeId);
  if (attempt === "unavailable") return yield* new Locked();
  if (attempt === "exhausted") {
    yield* destroyLoginChallenge(challenge.challengeId);
    return yield* new InvalidCode();
  }

  // コードの消費をチャレンジの消費より後に置くのは、並行して負けたときに再生成できないリカバリーコードを使い切らないため。
  const matched = yield* matchOwnedCode(challenge.userId, input).pipe(
    Effect.catchTag("NotEnabled", () => new ChallengeExpired()),
  );
  const clearCookie = yield* consumeLoginChallenge(challenge.challengeId);
  yield* consumeMatchedCode(challenge.userId, matched);

  // ここから先は巻き戻せないため、失敗をそのまま伝播させる。成功扱いにすると session の無い成功応答になる。
  const sessionHeaders = yield* MfaSessions.use((s) => s.issueSession(challenge.userId));

  const { ip, userAgent } = getClientContext(headers);
  yield* appendAuditLogBestEffort({
    eventType: "sign_in",
    userId: challenge.userId,
    payload: { method: challenge.method, ip, userAgent },
  });

  // append で追加する。set だと後段が前段の Set-Cookie を消してしまう。
  for (const cookie of clearCookie.getSetCookie()) sessionHeaders.append("set-cookie", cookie);

  // 返す直前に検証する。AUTH_TRUSTED_ORIGINS は保存してから取り出すまでの間に変わりうる。
  return {
    redirectUrl: yield* validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
