import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import { isMfaChallengeEnabled } from "../mfa/kill-switch";
import { FALLBACK_REDIRECT } from "../mfa/redirect-guard";
import { readMfaChallengeRequired } from "../mfa/totp/challenge-required";
import { buildLoginChallengeCookie } from "../mfa/totp/login-challenge";
import { captureCause, SentryService } from "../sentry";
import { isPrimaryAuthRoute, resolvePrimaryAuthMethod } from "./primary-auth-routes";

// 一次認証成功後の after-hook にチャレンジ強制を差し込む自前プラグイン (設計: ADR-0016)。
// チャレンジ要否は自前 mfa_totp 行から導出する (+1 SELECT。secret 列に触れない射影 — D5)。

const MFA_CHALLENGE_PAGE = "/auth/mfa";

// 止めている間は鳴り続ける (1 回きりだと warm isolate が黙る: ADR-0013 Consequences → 0016 が引き継ぐ)。
// 6 時間はオンコール交代を必ず 1 回またぐ粒度。
export const KILL_SWITCH_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let killSwitchReportedAt = 0;

// runtime は関数内で動的 import する (auth.ts から静的に辿れる module の規則: src/CLAUDE.md「Effect様式」)。
// 観測自体の失敗 (runtime の import / Sentry backend の throw) は握る。reject を素通しすると呼び出し側の
// fail-closed (dropIssuedSession / challengeRequired = true) が走らない (旧 facade は同期・非 throw だった)。
async function report(observe: Effect.Effect<void, never, SentryService>): Promise<void> {
  try {
    const { getRuntime } = await import("../runtime");
    await getRuntime().runPromise(observe);
  } catch (error) {
    console.error("[mfa-challenge] failed to report to Sentry", error);
  }
}

const reportFailure = (error: unknown): Promise<void> =>
  report(captureCause({ tags: { component: "mfa-challenge" } })({ cause: error }));

async function reportKillSwitchPeriodically(): Promise<void> {
  const now = Date.now();
  if (now - killSwitchReportedAt < KILL_SWITCH_REPORT_INTERVAL_MS) return;
  killSwitchReportedAt = now;
  await report(
    SentryService.use((sentry) =>
      sentry.captureMessage("mfa: challenge enforcement disabled by kill switch", {
        level: "warning",
        tags: { component: "mfa-challenge" },
      }),
    ),
  );
}

const enforceChallengeAfterPrimaryAuth = createAuthMiddleware(async (ctx) => {
  const issuedSession = ctx.context.newSession;
  if (!issuedSession) return;

  if (!isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED)) {
    await reportKillSwitchPeriodically();
    return;
  }
  // 判定の +1 SELECT が読めない時も fail-closed — throw を素通しすると after-hook が一次認証ごと
  // 500 にする (MFA 無効ユーザー含む)。チャレンジ画面へ倒し、再ログインに誘導する。
  let challengeRequired: boolean;
  try {
    challengeRequired = await readMfaChallengeRequired(issuedSession.user.id);
  } catch (error) {
    await reportFailure(error);
    challengeRequired = true;
  }
  if (!challengeRequired) return;

  // 失敗しない cookie クリアを先頭に置き、後段 (Upstash REST の DEL、リトライ無し) が落ちてもブラウザに
  // 使えるセッション cookie を残さない。upstream より前に出すのは、後段が落ちた時に sign-in-observer が
  // チャレンジ未通過のセッションを記帳するのを防ぐため。
  const dropIssuedSession = (): void => {
    deleteSessionCookie(ctx, true);
    ctx.context.setNewSession(null);
  };

  // 介入を決めた後の失敗は全て fail-closed — セッション cookie を落としたまま同じチャレンジ画面へ
  // 倒す (未成立なら画面が再ログイン導線を出す。判断の正本: ADR-0013 §1 → 0016 が引き継ぐ)。
  const handOffToChallenge = async (): Promise<void> => {
    try {
      // 未知 route は throw して fail-closed へ倒す (既定値に寄せると誤った method の sign_in audit が積まれる)。
      const method = resolvePrimaryAuthMethod(ctx);
      if (!method) throw new Error(`mfa-challenge: unmapped primary auth route ${ctx.path}`);
      const cookie = await buildLoginChallengeCookie({
        userId: issuedSession.user.id,
        // 一次認証経路は `throw ctx.redirect(...)` で終わり、dispatch が location を responseHeaders へ
        // 載せてから after-hook を呼ぶ。クエリから組み直すと newUserCallbackURL 差し替えと絶対化の再現が要る。
        redirectUrl: ctx.context.responseHeaders?.get("location") ?? FALLBACK_REDIRECT,
        method,
      });
      ctx.setCookie(cookie.name, cookie.value, cookie.attributes);
      dropIssuedSession();
      await ctx.context.internalAdapter.deleteSession(issuedSession.session.token);
    } catch (error) {
      // 失敗しない cookie クリアを観測より先に置く (観測を待つ間に何が起きてもセッションを残さない)。
      dropIssuedSession();
      await reportFailure(error);
    }
  };

  await handOffToChallenge();
  throw ctx.redirect(new URL(MFA_CHALLENGE_PAGE, ctx.context.baseURL).toString());
});

export const mfaChallenge = (): BetterAuthPlugin => ({
  id: "mfa-challenge",
  hooks: {
    after: [
      {
        matcher: (ctx) => isPrimaryAuthRoute(ctx.path),
        handler: enforceChallengeAfterPrimaryAuth,
      },
    ],
  },
});
