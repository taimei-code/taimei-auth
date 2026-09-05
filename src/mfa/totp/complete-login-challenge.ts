import { Effect } from "effect";
import { AuditLog } from "../../audit/ports";
import { swallowAuditFailure } from "../../audit/report-failure";
import { getClientContext } from "../../request-context";
import { ChallengeExpired, InvalidCode, Locked } from "../error-mapping";
import { validateChallengeRedirect } from "../redirect-guard";
import type { MfaCodeKind } from "../wire-contracts";
import {
  consumeLoginChallenge,
  destroyLoginChallenge,
  peekLoginChallenge,
  spendLoginChallengeAttempt,
} from "./login-challenge";
import { MfaSessions } from "./ports";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

// ログインチャレンジの通過手続 (A-10)。フローの順序が契約。
// sign_in audit は通過手続が記帳する (§4.6) — plugin verify 経路が消え observer の completion
// matcher は存在しないため。method はチャレンジ発行時に控えた値。
export const completeLoginChallenge = Effect.fn("mfa.completeLoginChallenge")(function* (
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
) {
  const challenge = yield* peekLoginChallenge(headers);
  if (!challenge) return yield* new ChallengeExpired();

  // per-challenge 5 回 (fail-closed)。上限到達はチャレンジ破棄 + invalid_code — SPA の
  // 「invalid_code → 再照会 → expired 表示」契約 (ADR-0013 §9) を保存する。以後は 401。
  const attempt = yield* spendLoginChallengeAttempt(challenge.challengeId);
  if (attempt === "unavailable") return yield* new Locked();
  if (attempt === "exhausted") {
    // 失効指示 cookie は返さない — 応答は invalid_code のままにし、SPA の再照会が pending:false を
    // 受けて expired 表示へ遷移する (ADR-0013 §9 の契約を保存)。
    yield* destroyLoginChallenge(challenge.challengeId);
    return yield* new InvalidCode();
  }

  // 照合 (副作用なし) を先に、消費をチャレンジ消費の後に置く — チャレンジの単回消費で敗北した時、
  // 再生成不能なリカバリーコードを焼かないため (焼失側は再発行自由なチャレンジ)。
  // not_enabled はチャレンジ発行後に無効化が完了した交差。登録状態を未認証応答へ漏らさない。
  const matched = yield* matchOwnedCode(challenge.userId, input).pipe(
    Effect.catchTag("NotEnabled", () => Effect.fail(new ChallengeExpired())),
  );

  const { consumed, clearCookie } = yield* consumeLoginChallenge(challenge.challengeId);
  if (!consumed) return yield* new ChallengeExpired();

  // false = 同一コードの並行消費・リプレイ (チャレンジは消費済み — 稀な交差は再ログインへ倒す)。
  if (!(yield* consumeMatchedCode(challenge.userId, matched))) return yield* new InvalidCode();

  // ここが巻き戻し不能点 — issueSession の失敗は AuthApiError のまま伝播する (チャレンジ消費済みで
  // 再ログインへ倒す fail-closed。成功扱いにすると session 無しの成功応答になる)。
  const sessionHeaders = yield* (yield* MfaSessions).issueSession(challenge.userId);

  const { ip, userAgent } = getClientContext(headers);
  const audit = yield* AuditLog;
  yield* audit
    .appendAuditLog({
      eventType: "sign_in",
      userId: challenge.userId,
      payload: { method: challenge.method, ip, userAgent },
    })
    .pipe(swallowAuditFailure("sign_in"));

  // append で積む — set だと後段が前段の Set-Cookie を落とす (同名 rotate も両方届ける)。
  for (const cookie of clearCookie.getSetCookie()) sessionHeaders.append("set-cookie", cookie);

  // 遷移先は「返す直前」に検証する — AUTH_TRUSTED_ORIGINS は保存と取り出しの間に変わりうる。
  return {
    redirectUrl: yield* validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
