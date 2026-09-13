import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { Cause, Clock, Data, Effect, Ref } from "effect";
import { AuthApi } from "../auth-service";
import { isMfaChallengeEnabled } from "../mfa/kill-switch";
import { FALLBACK_REDIRECT } from "../mfa/redirect-guard";
import { mfaChallengeRequired } from "../mfa/totp/challenge-required";
import { type LoginChallengeCookie, openLoginChallenge } from "../mfa/totp/login-challenge";
import { captureCause, SentryService } from "../sentry";
import {
  isPrimaryAuthRoute,
  parsePrimaryAuthRoute,
  type PrimaryAuthRoute,
  type UnmappedRoute,
} from "./primary-auth-routes";

const MFA_CHALLENGE_PAGE = "/auth/mfa";
const SENTRY_TAGS = { component: "mfa-challenge" } as const;

// 1 回きりだと warm isolate が黙るため鳴らし続ける。6 時間はオンコール交代を必ず 1 回またぐ粒度。
export const KILL_SWITCH_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const killSwitchReportedAt = Ref.makeUnsafe(0);

type IssuedSession = {
  userId: string;
  sessionToken: string;
  route: PrimaryAuthRoute;
  // better-auth は redirect の location を responseHeaders へ載せてから after-hook を呼ぶ。
  location: string | null | undefined;
  setCookie(cookie: LoginChallengeCookie): void;
  // 後段より前に落とす — 後段が落ちても未通過セッションを残さず、observer にも記帳させない。
  dropIssuedSession(): void;
};

class UnmappedPrimaryAuthRoute extends Data.TaggedError("UnmappedPrimaryAuthRoute")<{
  readonly route: UnmappedRoute;
}> {
  // Sentry は Error の name / message しか載せない (ExtraErrorData 未設定) ので route を message に畳む。
  override get message() {
    return `mfa-challenge: unmapped primary auth route ${this.route.path} (id=${this.route.providerId})`;
  }
}

// log: true は Info になるので Error を明示する。
const bestEffort = Effect.ignoreCause({ log: "Error" });

const reportFailure = (cause: Cause.Cause<unknown>) =>
  bestEffort(captureCause({ tags: SENTRY_TAGS })({ cause: Cause.squash(cause) }));

const reportKillSwitchPeriodically = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const due = yield* Ref.modify(killSwitchReportedAt, (last): readonly [boolean, number] =>
    now - last < KILL_SWITCH_REPORT_INTERVAL_MS ? [false, last] : [true, now],
  );
  if (!due) return;
  yield* bestEffort(
    SentryService.use((sentry) =>
      sentry.captureMessage("mfa: challenge enforcement disabled by kill switch", {
        level: "warning",
        tags: SENTRY_TAGS,
      }),
    ),
  );
});

const handOffToChallenge = Effect.fn("auth.handOffToMfaChallenge")(function* (
  input: IssuedSession,
) {
  if (input.route._tag === "Unmapped")
    return yield* new UnmappedPrimaryAuthRoute({ route: input.route });
  const cookie = yield* openLoginChallenge({
    userId: input.userId,
    redirectUrl: input.location ?? FALLBACK_REDIRECT,
    method: input.route.method,
  });
  input.setCookie(cookie);
  input.dropIssuedSession();
  yield* AuthApi.use((authApi) => authApi.deleteSession(input.sessionToken));
});

export const enforceChallenge = Effect.fn("auth.enforceMfaChallenge")(function* (
  input: IssuedSession,
) {
  if (!isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED)) {
    yield* reportKillSwitchPeriodically;
    return "pass" as const;
  }
  // 読めない時も fail-closed — 素通しにすると after-hook が一次認証ごと 500 にする。
  const required = yield* mfaChallengeRequired(input.userId).pipe(
    Effect.catchCause((cause) => reportFailure(cause).pipe(Effect.as(true))),
  );
  if (!required) return "pass" as const;
  // 介入を決めた後の失敗も fail-closed — cookie を落としたまま同じチャレンジ画面へ倒す。
  yield* handOffToChallenge(input).pipe(
    Effect.catchCause((cause) =>
      Effect.andThen(Effect.sync(input.dropIssuedSession), reportFailure(cause)),
    ),
  );
  return "challenge" as const;
});

const enforceChallengeAfterPrimaryAuth = createAuthMiddleware(async (ctx) => {
  const issued = ctx.context.newSession;
  if (!issued) return;

  const input: IssuedSession = {
    userId: issued.user.id,
    sessionToken: issued.session.token,
    route: parsePrimaryAuthRoute(ctx.path, ctx.params),
    location: ctx.context.responseHeaders?.get("location"),
    setCookie: (cookie) => ctx.setCookie(cookie.name, cookie.value, cookie.attributes),
    dropIssuedSession: () => {
      deleteSessionCookie(ctx, true);
      ctx.context.setNewSession(null);
    },
  };

  let decision: "pass" | "challenge";
  try {
    const { getRuntime } = await import("../runtime");
    decision = await getRuntime().runPromise(enforceChallenge(input));
  } catch (error) {
    console.error("[mfa-challenge] runtime unavailable", error);
    if (!isMfaChallengeEnabled(process.env.MFA_CHALLENGE_ENABLED)) return;
    input.dropIssuedSession();
    decision = "challenge";
  }
  if (decision === "challenge") {
    throw ctx.redirect(new URL(MFA_CHALLENGE_PAGE, ctx.context.baseURL).toString());
  }
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
