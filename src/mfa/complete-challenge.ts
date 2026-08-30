import { Sentry } from "../sentry";
import { asPreSessionHeaders, openChallenge } from "./challenge-store";
import { CHALLENGE_EXPIRED, failure, type MfaFailure } from "./error-mapping";
import { mergeForwardedCookies } from "./session-headers";
import { verifyMfaCodeWithoutGuard } from "./gateway";
import type { MfaCodeKind } from "./wire-contracts";
import { validateChallengeRedirect } from "./redirect-guard";

// ADR-0012 (Use-case 層): ログイン時 MFA チャレンジの通過手続。

export type CompleteChallengeResult =
  | { ok: true; redirectUrl: string; forwardedHeaders: Headers }
  | MfaFailure;

// 検証前にチャレンジ状態を解決するのは、遷移先と一次認証手段が検証成功の副作用で消えるため。
// gateway へ渡す headers は必ず asPreSessionHeaders を通す (理由の正本: challenge-store.ts)。
// sign_in audit はここでは発火しない — gateway 経由の sign-in-observer が 1 件だけ記帳する。
// 遷移先は「返す直前」に検証する — AUTH_TRUSTED_ORIGINS は保存と取り出しの間に変わりうる。
export async function completeChallenge(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): Promise<CompleteChallengeResult> {
  const challenge = await openChallenge(headers);
  if (!challenge) return failure(CHALLENGE_EXPIRED);

  // guard 外の総写像入口 (正本: ADR-0013 §8) — 未知の失敗も既知へ畳み、内部状態を漏らさない。
  const verified = await verifyMfaCodeWithoutGuard(await asPreSessionHeaders(headers), input);
  if (!verified.ok) return verified;

  // 後始末の失敗で成功を取り消さない。プラグインは完了マーカーを消費し新セッションを発行済みで、
  // 例外にすると Set-Cookie が転送されず「チャレンジは使い切ったのにセッションも無い」袋小路になる。
  const cleared = await challenge.consume().catch((error: unknown) => {
    Sentry.captureException(error, { tags: { component: "mfa-complete-challenge" } });
    return new Headers();
  });

  return {
    ok: true,
    redirectUrl: validateChallengeRedirect(challenge.redirectUrl),
    forwardedHeaders: mergeForwardedCookies(verified.headers, cleared),
  };
}
