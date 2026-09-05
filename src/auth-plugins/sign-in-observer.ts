import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { Clock, Effect } from "effect";
import { AuditLog } from "../audit/ports";
import { swallowAuditFailure } from "../audit/report-failure";
import { Background } from "../background";
import { EmailSender } from "../email/ports";
import { getClientContext } from "../request-context";
import { isPrimaryAuthRoute, resolvePrimaryAuthMethod } from "./primary-auth-routes";

// mfa-challenge の**後に**登録し null 化された newSession でスキップする — 登録順が正しさの前提 (ADR-0013)。
// 観測対象は一次認証のみ。チャレンジ通過の sign_in はチャレンジの通過手続が記帳する (ADR-0016 §4.6)。
// better-auth の hook は Promise 契約 (境界) なので、本体を Effect program にして runPromise で閉じる (ADR-0017)。

const NEW_USER_THRESHOLD_MS = 10000;

type SignedIn = {
  user: { id: string; email: string; name: string; createdAt: Date | string };
  path: string;
  params: Record<string, string> | undefined;
  headers: Headers | null | undefined;
};

const observe = Effect.fn("auth.observeSignIn")(function* (input: SignedIn) {
  const { user } = input;
  const background = yield* Background;
  const email = yield* EmailSender;
  const audit = yield* AuditLog;
  const now = yield* Clock.currentTimeMillis;

  // welcome メールを初回サインアップに限る (チャレンジ通過も rotate も初回でないため 2 通目防止)。
  if (now - new Date(user.createdAt).getTime() < NEW_USER_THRESHOLD_MS) {
    // Workers では fire-and-forget を waitUntil 経由にしないと "hung" になる (background.ts)。
    yield* background.run(
      email
        .sendWelcome(user.email, user.name)
        .pipe(Effect.catch((e) => Effect.logError("Welcome email failed:", e.cause))),
    );
  }

  // 未知の route / provider は記帳しない (誤った method の audit を黙って積まない: primary-auth-routes)。
  const method = resolvePrimaryAuthMethod({ path: input.path, params: input.params });
  if (!method) return;

  const { ip, userAgent } = getClientContext(input.headers);
  yield* background.run(
    audit
      .appendAuditLog({ eventType: "sign_in", userId: user.id, payload: { method, ip, userAgent } })
      .pipe(swallowAuditFailure("sign_in")),
  );
});

const observeSignIn = createAuthMiddleware(async (ctx) => {
  const establishedSession = ctx.context.newSession;
  if (!establishedSession) return;
  // runtime は関数内で動的 import する (auth.ts から静的に辿れる module の規則: src/CLAUDE.md「Effect様式」)。
  const { getRuntime } = await import("../runtime");
  await getRuntime().runPromise(
    observe({
      user: establishedSession.user,
      path: ctx.path,
      params: ctx.params,
      headers: ctx.headers,
    }),
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
