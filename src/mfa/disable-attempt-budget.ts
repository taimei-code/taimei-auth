import { Effect } from "effect";
import { TtlStore } from "../ttl-store-service";
import { captureCause } from "../sentry";
import { ATTEMPT_BUDGETS, attemptBudgetKey, spendAttemptBudgetFailClosed } from "../attempt-budget";
import { Locked } from "./errors";

const BUDGET = ATTEMPT_BUDGETS.mfaDisablePerUser;

export const disableAttemptsKey = (userId: string): string => attemptBudgetKey(BUDGET, userId);

export const spendDisableAttempt = Effect.fnUntraced(
  function* (userId: string) {
    yield* spendAttemptBudgetFailClosed(BUDGET, userId);
  },
  Effect.catchTag(["AttemptBudgetExhausted", "AttemptBudgetUnavailable"], () => new Locked()),
);

export const resetDisableAttempts = Effect.fnUntraced(function* (userId: string) {
  const ttlStore = yield* TtlStore;
  yield* ttlStore
    .delete(disableAttemptsKey(userId))
    .pipe(
      Effect.catchTag("TtlStoreError", captureCause({ tags: { component: BUDGET.component } })),
    );
});
