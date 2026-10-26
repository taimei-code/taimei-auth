import { Data, Effect } from "effect";
import { RateLimited } from "./failures";
import { TtlStore } from "./ttl-store-service";
import { captureCauseAs } from "./sentry";
import { type OwnKeyPrefix, ownKey, type TtlKey } from "./ttl-key";

export class AttemptBudgetExhausted extends Data.TaggedError("AttemptBudgetExhausted") {}

export class AttemptBudgetUnavailable extends Data.TaggedError("AttemptBudgetUnavailable") {}

export type WhenUncountable = "allow" | "deny";

export type AttemptBudget<Policy extends WhenUncountable> = {
  readonly keyPrefix: OwnKeyPrefix;
  readonly windowSeconds: number;
  readonly maxAttempts: () => number;
  readonly whenUncountable: Policy;
  readonly component: string;
};

const DEFAULT_INVITATIONS_PER_COMPANY_HOUR = 50;

const invitationsPerCompanyHour = (): number => {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INVITATIONS_PER_COMPANY_HOUR;
};

const perMinuteRouteBudget = (keyPrefix: OwnKeyPrefix, limit: number) =>
  ({
    keyPrefix,
    windowSeconds: 60,
    maxAttempts: () => limit,
    whenUncountable: "allow",
    component: "rate-limit",
  }) as const;

export const ATTEMPT_BUDGETS = {
  magicLinkPerIp: perMinuteRouteBudget("rate-limit:magic-link:ip", 5),
  magicLinkPerEmail: perMinuteRouteBudget("rate-limit:magic-link:email", 3),
  canaryTokenPerIp: perMinuteRouteBudget("rate-limit:canary:ip", 10),
  mfaChallengeVerifyPerIp: perMinuteRouteBudget("rate-limit:mfa-challenge:ip", 10),
  mfaChallengeStatePerIp: perMinuteRouteBudget("rate-limit:mfa-challenge-status:ip", 30),
  mfaChangePerSession: perMinuteRouteBudget("rate-limit:mfa-attempt", 10),
  invitationsPerCompanyHour: {
    keyPrefix: "invitation_rate",
    windowSeconds: 60 * 60,
    maxAttempts: invitationsPerCompanyHour,
    whenUncountable: "allow",
    component: "invitation-rate-limit",
  },
  mfaDisablePerUser: {
    keyPrefix: "mfa:disable-attempts",
    windowSeconds: 15 * 60,
    maxAttempts: () => 5,
    whenUncountable: "deny",
    component: "mfa-disable-attempt-budget",
  },
  mfaLoginChallenge: {
    keyPrefix: "mfa:login-challenge-attempts",
    windowSeconds: 600,
    maxAttempts: () => 5,
    whenUncountable: "deny",
    component: "mfa-login-challenge",
  },
} as const satisfies Record<string, AttemptBudget<WhenUncountable>>;

export const attemptBudgetKey = (budget: AttemptBudget<WhenUncountable>, subject: string): TtlKey =>
  ownKey(budget.keyPrefix, subject);

const spend = Effect.fnUntraced(function* (
  budget: AttemptBudget<WhenUncountable>,
  subject: string,
) {
  const ttlStore = yield* TtlStore;
  const counted = yield* ttlStore
    .incrementRateWindow(attemptBudgetKey(budget, subject), budget.windowSeconds)
    .pipe(
      Effect.filterOrFail(
        (result) => result.count >= 1,
        (result) => ({
          cause: new Error(`incrementRateWindow: 応答が契約に外れる (count=${result.count})`),
        }),
      ),
      Effect.catch(captureCauseAs(null, { tags: { component: budget.component } })),
    );
  if (!counted) return yield* new AttemptBudgetUnavailable();
  const maxAttempts = budget.maxAttempts();
  if (counted.count > maxAttempts) return yield* new AttemptBudgetExhausted();
  return { attemptsLeft: maxAttempts - counted.count };
});

export const spendAttemptBudgetFailClosed = (budget: AttemptBudget<"deny">, subject: string) =>
  spend(budget, subject);

export const spendAttemptBudgetFailOpen = (budget: AttemptBudget<"allow">, subject: string) =>
  spend(budget, subject).pipe(
    Effect.asVoid,
    Effect.catchTag("AttemptBudgetUnavailable", () => Effect.void),
  );

export const spendAttemptBudgetOrRateLimited = (budget: AttemptBudget<"allow">, subject: string) =>
  spendAttemptBudgetFailOpen(budget, subject).pipe(
    Effect.catchTag("AttemptBudgetExhausted", () => new RateLimited()),
  );
