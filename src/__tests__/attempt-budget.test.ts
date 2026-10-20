import { describe, expect, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import {
  ATTEMPT_BUDGETS,
  type AttemptBudget,
  AttemptBudgetExhausted,
  AttemptBudgetUnavailable,
  attemptBudgetKey,
  spendAttemptBudgetFailClosed,
  spendAttemptBudgetFailOpen,
  type WhenUncountable,
} from "../attempt-budget";
import type { TtlStore } from "../ttl-store-service";
import { SentryLive, type SentryService } from "../sentry";
import { recordSentry } from "./sentry-recorder";
import { failingTtlStoreLayer, ttlStoreReturning } from "./test-layers";

spendAttemptBudgetFailOpen satisfies (
  budget: AttemptBudget<"allow">,
  subject: string,
) => Effect.Effect<void, AttemptBudgetExhausted, TtlStore | SentryService>;
spendAttemptBudgetFailClosed satisfies (
  budget: AttemptBudget<"deny">,
  subject: string,
) => Effect.Effect<
  { attemptsLeft: number },
  AttemptBudgetExhausted | AttemptBudgetUnavailable,
  TtlStore | SentryService
>;

const budgetOf = <Policy extends WhenUncountable>(whenUncountable: Policy) => ({
  keyPrefix: "attempt-budget-test",
  windowSeconds: 60,
  maxAttempts: () => 5,
  whenUncountable,
  component: "c",
});

const spendDenying = (subject: string) => spendAttemptBudgetFailClosed(budgetOf("deny"), subject);
const spendAllowing = (subject: string) => spendAttemptBudgetFailOpen(budgetOf("allow"), subject);

const resultOf = (
  program: Effect.Effect<
    unknown,
    AttemptBudgetExhausted | AttemptBudgetUnavailable,
    TtlStore | SentryService
  >,
  ttlStore: Layer.Layer<TtlStore>,
) =>
  Effect.runPromise(
    Effect.result(program).pipe(Effect.provide(Layer.mergeAll(ttlStore, SentryLive))),
  );

describe.each([
  [
    "spendAttemptBudgetFailClosed",
    spendDenying,
    Result.fail(new AttemptBudgetUnavailable()),
    Result.succeed({ attemptsLeft: 0 }),
  ],
  [
    "spendAttemptBudgetFailOpen",
    spendAllowing,
    Result.succeed(undefined),
    Result.succeed(undefined),
  ],
] as const)("%s", (_, spend, whenUncountable, whenAtLimit) => {
  const { exceptions: captured } = recordSentry();

  test("計数不能 (TtlStoreError) は fail-closed なら拒否、fail-open なら通し、Sentry に component 付き warning で 1 回記録する", async () => {
    const before = captured.length;
    expect(await resultOf(spend("s"), failingTtlStoreLayer)).toEqual(whenUncountable);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("TTL store が契約に外れた count 0 を返しても (ttl-store.ts の toRateWindowResult が throw し損ねた場合)、計数不能と同じ扱いになり、Sentry に component 付き warning で 1 回記録する", async () => {
    const before = captured.length;
    expect(await resultOf(spend("s"), ttlStoreReturning({ count: 0 }))).toEqual(whenUncountable);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("c");
    expect(captured.at(-1)?.[1]?.level).toBe("warning");
  });

  test("count が上限ちょうどなら通す", async () => {
    expect(await resultOf(spend("s"), ttlStoreReturning({ count: 5 }))).toEqual(whenAtLimit);
  });

  test("count が上限を 1 超えたら AttemptBudgetExhausted", async () => {
    expect(await resultOf(spend("s"), ttlStoreReturning({ count: 6 }))).toEqual(
      Result.fail(new AttemptBudgetExhausted()),
    );
  });
});

test("fail-closed 版は上限未満なら残りの試行回数を返す", async () => {
  expect(await resultOf(spendDenying("s"), ttlStoreReturning({ count: 3 }))).toEqual(
    Result.succeed({ attemptsLeft: 2 }),
  );
});

test.each([
  [ATTEMPT_BUDGETS.magicLinkPerIp, "203.0.113.1", "rate-limit:magic-link:ip:203.0.113.1"],
  [ATTEMPT_BUDGETS.magicLinkPerEmail, "a@example.com", "rate-limit:magic-link:email:a@example.com"],
  [ATTEMPT_BUDGETS.canaryTokenPerIp, "203.0.113.1", "rate-limit:canary:ip:203.0.113.1"],
  [
    ATTEMPT_BUDGETS.mfaChallengeVerifyPerIp,
    "203.0.113.1",
    "rate-limit:mfa-challenge:ip:203.0.113.1",
  ],
  [
    ATTEMPT_BUDGETS.mfaChallengeStatePerIp,
    "203.0.113.1",
    "rate-limit:mfa-challenge-status:ip:203.0.113.1",
  ],
  [ATTEMPT_BUDGETS.mfaChangePerSession, "ip:203.0.113.1", "rate-limit:mfa-attempt:ip:203.0.113.1"],
  [ATTEMPT_BUDGETS.mfaChangePerSession, "session:abc", "rate-limit:mfa-attempt:session:abc"],
  [
    ATTEMPT_BUDGETS.invitationsPerCompanyHour,
    "company-1:2026-10-14T09",
    "invitation_rate:company-1:2026-10-14T09",
  ],
  [ATTEMPT_BUDGETS.mfaDisablePerUser, "user-1", "mfa:disable-attempts:user-1"],
  [ATTEMPT_BUDGETS.mfaLoginChallenge, "challenge-1", "mfa:login-challenge-attempts:challenge-1"],
] as const)("試行枠の鍵は宣言の前の文字列と同じになる (deploy で計数が消えない): %#", (budget, subject, key) => {
  expect(attemptBudgetKey(budget, subject)).toBe(key);
});
