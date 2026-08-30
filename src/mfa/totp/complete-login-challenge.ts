import { getClientContext } from "../../request-context";
import {
  CHALLENGE_EXPIRED,
  failure,
  INVALID_CODE,
  LOCKED,
  type MfaFailure,
} from "../error-mapping";
import { validateChallengeRedirect } from "../redirect-guard";
import { mergeForwardedCookies } from "../session-headers";
import type { MfaCodeKind } from "../wire-contracts";
import {
  consumeLoginChallenge,
  destroyLoginChallenge,
  peekLoginChallenge,
  spendLoginChallengeAttempt,
  type ChallengeMethod,
} from "./login-challenge";
import type { KeyRingSource } from "./ports";
import { consumeMatchedCode, matchOwnedCode } from "./verify-code";

// ログインチャレンジの通過手続 (A-10)。フローの順序が契約。

export type LoginChallengeCompletionResult =
  | { ok: true; redirectUrl: string; forwardedHeaders: Headers }
  | MfaFailure;

export type LoginChallengeCompletionDependencies = {
  ring: KeyRingSource;
  issueSession(userId: string): Promise<Headers>;
  writeSignInAudit(input: {
    userId: string;
    method: ChallengeMethod;
    ip: string;
    userAgent: string;
  }): Promise<void>;
  observeAuditError(error: unknown): void;
};

export function createLoginChallengeCompletion(deps: LoginChallengeCompletionDependencies) {
  return async function completeLoginChallenge(
    headers: Headers,
    input: { code: string; kind: MfaCodeKind },
  ): Promise<LoginChallengeCompletionResult> {
    const challenge = await peekLoginChallenge(headers);
    if (!challenge) return failure(CHALLENGE_EXPIRED);

    // per-challenge 5 回 (fail-closed)。上限到達はチャレンジ破棄 + invalid_code — SPA の
    // 「invalid_code → 再照会 → expired 表示」契約 (ADR-0013 §9) を保存する。以後は 401。
    const attempt = await spendLoginChallengeAttempt(challenge.challengeId);
    if (attempt === "unavailable") return failure(LOCKED);
    if (attempt === "exhausted") {
      // 失効指示 cookie は返さない — 応答は invalid_code のままにし、SPA の再照会が pending:false を
      // 受けて expired 表示へ遷移する (ADR-0013 §9 の契約を保存)。
      await destroyLoginChallenge(challenge.challengeId);
      return failure(INVALID_CODE);
    }

    // 照合 (副作用なし) を先に、消費をチャレンジ消費の後に置く — チャレンジの単回消費で敗北した時、
    // 再生成不能なリカバリーコードを焼かないため (焼失側は再発行自由なチャレンジ)。
    const matched = await matchOwnedCode(deps.ring(), challenge.userId, input);
    if (!matched.ok) {
      // not_enabled はチャレンジ発行後に無効化が完了した交差。登録状態を未認証応答へ漏らさない。
      return matched.error === "not_enabled" ? failure(CHALLENGE_EXPIRED) : matched;
    }

    const { consumed, clearCookie } = await consumeLoginChallenge(challenge.challengeId);
    if (!consumed) return failure(CHALLENGE_EXPIRED);

    // false = 同一コードの並行消費・リプレイ (チャレンジは消費済み — 稀な交差は再ログインへ倒す)。
    if (!(await consumeMatchedCode(challenge.userId, matched.matched))) {
      return failure(INVALID_CODE);
    }

    // ここが巻き戻し不能点 — issueSession の失敗は throw のまま伝播する (チャレンジ消費済みで
    // 再ログインへ倒す fail-closed。成功扱いにすると session 無しの成功応答になる)。
    const sessionHeaders = await deps.issueSession(challenge.userId);

    const { ip, userAgent } = getClientContext(headers);
    await deps
      .writeSignInAudit({ userId: challenge.userId, method: challenge.method, ip, userAgent })
      .catch(deps.observeAuditError);

    // 遷移先は「返す直前」に検証する — AUTH_TRUSTED_ORIGINS は保存と取り出しの間に変わりうる。
    return {
      ok: true,
      redirectUrl: validateChallengeRedirect(challenge.redirectUrl),
      forwardedHeaders: mergeForwardedCookies(sessionHeaders, clearCookie),
    };
  };
}
