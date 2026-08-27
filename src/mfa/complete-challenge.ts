import { Sentry } from "../sentry";
import { asPreSessionHeaders, openChallenge } from "./challenge-store";
import { CHALLENGE_EXPIRED, failure, type MfaFailure } from "./error-mapping";
import { mergeForwardedCookies } from "./session-headers";
import { verifyMfaCodeWithoutGuard } from "./gateway";
import type { MfaCodeKind } from "./wire-contracts";
import { validateChallengeRedirect } from "./redirect-guard";

// ADR-0012 (Use-case 層): ログイン時 MFA チャレンジの通過手続。一次認証済みでセッションを
// 持たないブラウザが、第二要素を提示してセッションを得る。

export type CompleteChallengeResult =
  | { ok: true; redirectUrl: string; forwardedHeaders: Headers }
  | MfaFailure;

// 検証前にチャレンジ状態を解決するのは、遷移先と一次認証手段が検証成功の副作用で消えるため
// (プラグインが完了マーカーを消費し、こちらが補助キーを消す)。
//
// gateway へは asPreSessionHeaders を通した headers だけを渡し、プラグインの試行制限が効く
// セッション無し経路に確実に乗せる (挙動: gateway.ts の verifyMfaCodeWithoutGuard)。
//
// sign_in audit はここでは発火しない。検証は gateway 経由でプラグイン本体を通るため、
// その after-hook に載っている sign-in-observer が 1 件だけ記帳する (二重記帳の回避)。
//
// 遷移先の検証は「返す直前」に置く。発行時に検証済みでも、保存と取り出しの間に
// AUTH_TRUSTED_ORIGINS が変わる可能性があり、外向きに出す値は出口で確定させる。
export async function completeChallenge(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): Promise<CompleteChallengeResult> {
  const challenge = await openChallenge(headers);
  if (!challenge) return failure(CHALLENGE_EXPIRED);

  // guard を持たない経路なので総写像入口を使う。未知の失敗も既知へ畳み、未認証ブラウザに内部状態を漏らさない。
  const verified = await verifyMfaCodeWithoutGuard(await asPreSessionHeaders(headers), input);
  if (!verified.ok) return verified;

  // 後始末の失敗で成功を取り消さない。ここに来た時点でプラグインは完了マーカーを消費し新セッションを
  // 発行済みで、例外にすると Set-Cookie が転送されず「チャレンジは使い切ったのにセッションも無い」
  // 袋小路になる。cookie 失効指示は verified.headers 側にも載り、補助キーは 600 秒 TTL で自然に
  // 消えるため、消し漏れは残留ごみに留まる。
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
