import { Effect } from "effect";
import { TtlStore } from "../ttl-store-service";
import { captureCause } from "../sentry";
import { spendAttemptBudgetFailClosed } from "../attempt-budget";
import { Locked } from "./errors";

export const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

const WINDOW_SECONDS = 15 * 60;
export const DISABLE_ATTEMPT_LIMIT = 5;
const COMPONENT = "mfa-disable-attempt-budget";

export const spendDisableAttempt = Effect.fnUntraced(
  function* (userId: string) {
    yield* spendAttemptBudgetFailClosed({
      key: disableAttemptsKey(userId),
      windowSeconds: WINDOW_SECONDS,
      maxAttempts: DISABLE_ATTEMPT_LIMIT,
      component: COMPONENT,
    });
  },
  Effect.catchTag(["AttemptBudgetExhausted", "AttemptBudgetUnavailable"], () => new Locked()),
);

export const resetDisableAttempts = Effect.fnUntraced(function* (userId: string) {
  const ttlStore = yield* TtlStore;
  yield* ttlStore
    .delete(disableAttemptsKey(userId))
    .pipe(Effect.catchTag("TtlStoreError", captureCause({ tags: { component: COMPONENT } })));
});
