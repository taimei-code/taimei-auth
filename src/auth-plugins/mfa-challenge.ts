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

// twoFactor プラグインのチャレンジ強制 after-hook は `/sign-in/email|username|phone-number` に
// しか match せず、本サービスの一次認証では 1 度も発火しない。その差分だけを本プラグインが埋め、
// TOTP の検証・保管・試行制限はプラグイン本体に残す。
//
// 撤退線: upstream がチャレンジ範囲の再拡大 (per-method opt-out) を出したら本プラグインを捨てて
// 標準機構へ移行する。その時に触るのは challenge-store と src/auth.ts のプラグイン登録だけ。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

const MFA_CHALLENGE_PAGE = "/auth/mfa";

let killSwitchReported = false;

function reportKillSwitchOnce(): void {
  if (killSwitchReported) return;
  killSwitchReported = true;
  Sentry.captureMessage("mfa: challenge enforcement disabled by kill switch", {
    level: "warning",
    tags: { component: "mfa-challenge" },
  });
}

// `/magic-link/verify` も `/callback/:id` も最後は `throw ctx.redirect(...)` で終わり、dispatch が
// その location を `ctx.context.responseHeaders` へ載せてから after-hook を呼ぶ。クエリから組み
// 直さないのは、新規 user 時の newUserCallbackURL 差し替えと baseURL 起点の絶対化まで再現する
// 必要がなくなるため。location が無いのは callbackURL 省略で JSON を返した API 呼び出しだけ。
function pendingRedirectTarget(responseHeaders: Headers | undefined): string {
  return responseHeaders?.get("location") ?? FALLBACK_REDIRECT;
}

function requirePrimaryAuthMethod(route: AuthRouteMatch): ChallengeMethod {
  const method = resolvePrimaryAuthMethod(route);
  if (!method) throw new Error(`mfa-challenge: unmapped primary auth route ${route.path}`);
  return method;
}

// better-auth の session user 型は plugin 由来の追加列を `Record<string, any>` でしか公開しないため、
// policy が要求する boolean への確定はこの 1 箇所で行う (判定自体は requiresMfaChallenge が持つ)。
// 列を欠くのはロールアウト前に secondaryStorage へ載った古い payload だけで、その時点ではまだ誰も
// MFA を有効化できていないため false 扱いで正しい。
function asMfaPolicyUser(user: Record<string, unknown>): { twoFactorEnabled: boolean } {
  return { twoFactorEnabled: Boolean(user.twoFactorEnabled) };
}

const enforceChallengeAfterPrimaryAuth = createAuthMiddleware(async (ctx) => {
  const issuedSession = ctx.context.newSession;
  if (!issuedSession) return;

  if (!isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED)) {
    reportKillSwitchOnce();
    return;
  }
  if (!requiresMfaChallenge(asMfaPolicyUser(issuedSession.user))) return;

  // 失敗しない cookie クリアを先頭に置くことで、後段 (本番は Upstash REST の DEL 1 HTTP、リトライ
  // 無し) が落ちてもブラウザに使えるセッション cookie を残さない。upstream の twoFactor プラグインは
  // setNewSession(null) を最後に置くが、ここでは deleteSession より前に出す — 後段が落ちた時に
  // 後続の sign-in-observer がチャレンジ未通過のセッションを観測して記帳するのを防ぐため。
  const dropIssuedSession = (): void => {
    deleteSessionCookie(ctx, true);
    ctx.context.setNewSession(null);
  };

  // 介入を決めた後は「元の 302 を通さない」が最優先。fail-open にすると MFA を有効にした user が
  // 第二要素なしでセッションを得るため、issueChallenge の失敗も破棄途中の失敗も、セッション
  // cookie を落としたまま同じチャレンジ画面へ倒す (未成立なら画面が再ログイン導線を出す)。
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
// gateway の `auth.api.*` は headers だけを渡し request を持たないため、この 1 行が「生 path は
// ブラウザから届かない / 自前 REST の server-side 呼び出しは通る」を両立させる。
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
