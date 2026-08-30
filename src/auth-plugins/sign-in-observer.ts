import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../audit-error";
import { runBackground } from "../background";
import { sendWelcomeEmail } from "../email/send-welcome";
import { getClientContext } from "../request-context";
import { isPrimaryAuthRoute, resolvePrimaryAuthMethod } from "./primary-auth-routes";

// mfa-challenge の**後に**登録し null 化された newSession でスキップする — 登録順が正しさの前提 (ADR-0013)。
// 観測対象は一次認証のみ。チャレンジ通過の sign_in はチャレンジの通過手続が記帳する (ADR-0016 §4.6)。

const NEW_USER_THRESHOLD_MS = 10000;

const isJustSignedUp = (createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() < NEW_USER_THRESHOLD_MS;

const observeSignIn = createAuthMiddleware(async (ctx) => {
  const establishedSession = ctx.context.newSession;
  if (!establishedSession) return;
  const { user } = establishedSession;

  // welcome メールを初回サインアップに限る (チャレンジ通過も rotate も初回でないため 2 通目防止)。
  if (isJustSignedUp(new Date(user.createdAt))) {
    // Workers では fire-and-forget を waitUntil 経由にしないと "hung" になる (background.ts)。
    runBackground(
      sendWelcomeEmail(user.email, user.name).catch((e) =>
        console.error("Welcome email failed:", e),
      ),
    );
  }

  // 未知の route / provider は記帳しない (誤った method の audit を黙って積まない: primary-auth-routes)。
  const method = resolvePrimaryAuthMethod({ path: ctx.path, params: ctx.params });
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
        matcher: (ctx) => isPrimaryAuthRoute(ctx.path),
        handler: observeSignIn,
      },
    ],
  },
});
