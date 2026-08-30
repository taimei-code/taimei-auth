import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../audit-error";
import { runBackground } from "../background";
import { sendWelcomeEmail } from "../email/send-welcome";
import type { RawTwoFactorPath } from "../mfa/blocked-paths";
import { readChallengeMethod, type ChallengeMethod } from "../mfa/challenge-store";
import { getClientContext } from "../request-context";
import {
  isPrimaryAuthRoute,
  resolvePrimaryAuthMethod,
  type AuthRouteMatch,
} from "./primary-auth-routes";

// mfa-challenge の**後に**登録し null 化された newSession でスキップする — 登録順が正しさの前提 (ADR-0013)。

// RawTwoFactorPath で型付けし、blocked-paths カタログ側の path が変われば型エラーで気付ける状態にする。
const CHALLENGE_COMPLETION_ROUTES = [
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
] as const satisfies readonly RawTwoFactorPath[];

const NEW_USER_THRESHOLD_MS = 10000;

const isJustSignedUp = (createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() < NEW_USER_THRESHOLD_MS;

function isChallengeCompletionRoute(path: string | undefined): boolean {
  return CHALLENGE_COMPLETION_ROUTES.some((route) => route === path);
}

// チャレンジ通過時の一次認証手段は path から引けないため発行時に控えた値を引く (完了マーカーは検証成功で
// 消費済みのためマーカー非依存)。MFA 有効化の rotate は `two_factor` cookie を持たず記帳されない。
async function resolveSignInMethod(
  route: AuthRouteMatch,
  headers: Headers | undefined,
): Promise<ChallengeMethod | undefined> {
  if (isPrimaryAuthRoute(route.path)) return resolvePrimaryAuthMethod(route);
  return headers ? readChallengeMethod(headers) : undefined;
}

const observeSignIn = createAuthMiddleware(async (ctx) => {
  const establishedSession = ctx.context.newSession;
  if (!establishedSession) return;
  const { user } = establishedSession;

  // welcome メールを一次認証 path に限るのは、チャレンジ通過も rotate も初回サインアップでないため (2 通目防止)。
  if (isPrimaryAuthRoute(ctx.path) && isJustSignedUp(new Date(user.createdAt))) {
    // Workers では fire-and-forget を waitUntil 経由にしないと "hung" になる (background.ts)。
    runBackground(
      sendWelcomeEmail(user.email, user.name).catch((e) =>
        console.error("Welcome email failed:", e),
      ),
    );
  }

  const method = await resolveSignInMethod({ path: ctx.path, params: ctx.params }, ctx.headers);
  if (!method) return;

  const { ip, userAgent } = getClientContext(ctx.headers);
  runBackground(
    appendAuditLog({
      eventType: "sign_in",
      userId: user.id,
      payload: { method, ip, userAgent },
    }).catch((e) => captureAuditLogError("sign_in", e)),
  );
});

export const signInObserver = (): BetterAuthPlugin => ({
  id: "sign-in-observer",
  hooks: {
    after: [
      {
        matcher: (ctx) => isPrimaryAuthRoute(ctx.path) || isChallengeCompletionRoute(ctx.path),
        handler: observeSignIn,
      },
    ],
  },
});
