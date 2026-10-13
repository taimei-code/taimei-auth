import { Cause, Clock, Data, Effect, Ref } from "effect";
import { AuthApi } from "../auth-service";
import { FALLBACK_REDIRECT } from "../mfa/redirect-guard";
import { mfaChallengeRequired } from "../mfa/totp/challenge-required";
import { type LoginChallengeCookie, openLoginChallenge } from "../mfa/totp/login-challenge";
import { captureCause, SentryService } from "../sentry";
import type { PrimaryAuthRoute, UnmappedRoute } from "./primary-auth-routes";

export const MFA_CHALLENGE_PAGE = "/auth/mfa";
const SENTRY_TAGS = { component: "mfa-challenge" } as const;

// 1 回きりだと warm isolate で二度と報告されない。6 時間はオンコール交代を 1 回またぐ間隔。
export const KILL_SWITCH_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const killSwitchReportedAt = Ref.makeUnsafe(0);

type ChallengeInput = {
  userId: string;
  sessionToken: string;
  route: PrimaryAuthRoute;
  // better-auth は redirect 先を responseHeaders に設定してから after-hook を呼ぶ。
  location: string | null | undefined;
  challengeEnabled: boolean;
};

export type ChallengeDecision =
  | { readonly _tag: "Pass" }
  | { readonly _tag: "Challenge"; readonly cookie: LoginChallengeCookie | null };

export const PASS: ChallengeDecision = { _tag: "Pass" };
export const challengeWith = (cookie: LoginChallengeCookie | null): ChallengeDecision => ({
  _tag: "Challenge",
  cookie,
});

class UnmappedPrimaryAuthRoute extends Data.TaggedError("UnmappedPrimaryAuthRoute")<{
  readonly route: UnmappedRoute;
}> {
  // Sentry には name と message しか送られない (ExtraErrorData 未設定) ため route を message に含める。
  override get message() {
    return `mfa-challenge: unmapped primary auth route ${this.route.path} (id=${this.route.providerId})`;
  }
}

// log: true だと Info レベルになるため、Error を明示する。
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

const openChallengeCookie = Effect.fnUntraced(function* (input: ChallengeInput) {
  if (input.route._tag === "Unmapped")
    return yield* new UnmappedPrimaryAuthRoute({ route: input.route });
  return yield* openLoginChallenge({
    userId: input.userId,
    redirectUrl: input.location ?? FALLBACK_REDIRECT,
    method: input.route.method,
  });
});

export const enforceChallenge = Effect.fnUntraced(function* (input: ChallengeInput) {
  if (!input.challengeEnabled) {
    yield* reportKillSwitchPeriodically;
    return PASS;
  }
  // 読めない時も fail-closed。素通しにすると after-hook が一次認証ごと 500 にする。
  const required = yield* mfaChallengeRequired(input.userId).pipe(
    Effect.catchCause((cause) => reportFailure(cause).pipe(Effect.as(true))),
  );
  if (!required) return PASS;
  const cookie = yield* openChallengeCookie(input).pipe(
    Effect.catchCause((cause) => reportFailure(cause).pipe(Effect.as(null))),
  );
  yield* AuthApi.use((authApi) => authApi.deleteSession(input.sessionToken)).pipe(
    Effect.catchCause(reportFailure),
  );
  return challengeWith(cookie);
});
