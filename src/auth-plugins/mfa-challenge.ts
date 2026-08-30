import { APIError, type BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { RAW_TWO_FACTOR_PATHS } from "../mfa/blocked-paths";
import { issueChallenge, type ChallengeMethod } from "../mfa/challenge-store";
import { isMfaChallengeEnabled } from "../mfa/kill-switch";
import { requiresMfaChallenge } from "../mfa/policy";
import { FALLBACK_REDIRECT } from "../mfa/redirect-guard";
import { Sentry } from "../sentry";
import {
  isPrimaryAuthRoute,
  resolvePrimaryAuthMethod,
  type AuthRouteMatch,
} from "./primary-auth-routes";

// プラグインの after-hook が発火しない一次認証経路にチャレンジ強制を差し込む自前プラグイン
// (ハイブリッド構成の理由と撤退線: ADR-0013 §1)。

const MFA_CHALLENGE_PAGE = "/auth/mfa";

// 止めている間は鳴り続ける (1 回きりだと warm isolate が黙る: ADR-0013 Consequences)。
// 6 時間はオンコール交代を必ず 1 回またぐ粒度。
export const KILL_SWITCH_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

let killSwitchReportedAt = 0;

function reportKillSwitchPeriodically(): void {
  const now = Date.now();
  if (now - killSwitchReportedAt < KILL_SWITCH_REPORT_INTERVAL_MS) return;
  killSwitchReportedAt = now;
  Sentry.captureMessage("mfa: challenge enforcement disabled by kill switch", {
    level: "warning",
    tags: { component: "mfa-challenge" },
  });
}

// 一次認証経路は `throw ctx.redirect(...)` で終わり、dispatch が location を responseHeaders へ
// 載せてから after-hook を呼ぶ。クエリから組み直すと newUserCallbackURL 差し替えと絶対化の再現が要る。
function pendingRedirectTarget(responseHeaders: Headers | undefined): string {
  return responseHeaders?.get("location") ?? FALLBACK_REDIRECT;
}

function requirePrimaryAuthMethod(route: AuthRouteMatch): ChallengeMethod {
  const method = resolvePrimaryAuthMethod(route);
  if (!method) throw new Error(`mfa-challenge: unmapped primary auth route ${route.path}`);
  return method;
}

// session user 型は plugin 由来の列を `Record<string, any>` でしか公開しないため、boolean への確定は
// ここ 1 箇所で行う (判定は requiresMfaChallenge)。列を欠くのは古い payload だけで false 扱いが正しい。
function asMfaPolicyUser(user: Record<string, unknown>): { twoFactorEnabled: boolean } {
  return { twoFactorEnabled: Boolean(user.twoFactorEnabled) };
}

const enforceChallengeAfterPrimaryAuth = createAuthMiddleware(async (ctx) => {
  const issuedSession = ctx.context.newSession;
  if (!issuedSession) return;

  if (!isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED)) {
    reportKillSwitchPeriodically();
    return;
  }
  if (!requiresMfaChallenge(asMfaPolicyUser(issuedSession.user))) return;

  // 失敗しない cookie クリアを先頭に置き、後段 (Upstash REST の DEL、リトライ無し) が落ちてもブラウザに
  // 使えるセッション cookie を残さない。upstream より前に出すのは、後段が落ちた時に sign-in-observer が
  // チャレンジ未通過のセッションを記帳するのを防ぐため。
  const dropIssuedSession = (): void => {
    deleteSessionCookie(ctx, true);
    ctx.context.setNewSession(null);
  };

  // 介入を決めた後の失敗は全て fail-closed — セッション cookie を落としたまま同じチャレンジ画面へ
  // 倒す (未成立なら画面が再ログイン導線を出す。判断の正本: ADR-0013 §1)。
  const handOffToChallenge = async (): Promise<void> => {
    try {
      await issueChallenge(ctx, {
        userId: issuedSession.user.id,
        redirectUrl: pendingRedirectTarget(ctx.context.responseHeaders),
        method: requirePrimaryAuthMethod(ctx),
      });
      dropIssuedSession();
      await ctx.context.internalAdapter.deleteSession(issuedSession.session.token);
    } catch (error) {
      Sentry.captureException(error, { tags: { component: "mfa-challenge" } });
      dropIssuedSession();
    }
  };

  await handOffToChallenge();
  throw ctx.redirect(new URL(MFA_CHALLENGE_PAGE, ctx.context.baseURL).toString());
});

// ブラウザ由来かの判定に path でなく `ctx.request` の有無を使う (originCheck と同じ discriminator)。
// gateway は headers だけを渡すため、「生 path は遮断 / server-side 呼び出しは通る」が両立する。
const blockRawTwoFactorRoutes = createAuthMiddleware(async (ctx) => {
  if (!ctx.request) return;
  throw new APIError("FORBIDDEN", {
    code: "TWO_FACTOR_ROUTE_BLOCKED",
    message: "この経路は利用できません。",
  });
});

export const mfaChallenge = (): BetterAuthPlugin => ({
  id: "mfa-challenge",
  hooks: {
    before: [
      {
        matcher: (ctx) => RAW_TWO_FACTOR_PATHS.some((path) => path === ctx.path),
        handler: blockRawTwoFactorRoutes,
      },
    ],
    after: [
      {
        matcher: (ctx) => isPrimaryAuthRoute(ctx.path),
        handler: enforceChallengeAfterPrimaryAuth,
      },
    ],
  },
});
