import { Effect } from "effect";
import { TtlStore } from "../ttl-store-service";
import { captureCause } from "../sentry";
import { spendAttemptBudgetFailClosed } from "../attempt-budget";
import { Locked } from "./error-mapping";

// セッション有りの経路で 6 桁コードの総当たりを止める唯一の防御。

export const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const COMPONENT = "mfa-disable-attempt-budget";

export const spendDisableAttempt = Effect.fnUntraced(
  function* (userId: string) {
    yield* spendAttemptBudgetFailClosed({
      key: disableAttemptsKey(userId),
      windowSeconds: WINDOW_SECONDS,
      maxAttempts: MAX_ATTEMPTS,
      component: COMPONENT,
    });
  },
  Effect.catchTag(["AttemptBudgetExhausted", "AttemptBudgetUnavailable"], () => new Locked()),
);

// 消し損ねは fail-open でよい。counter は TTL で消え、次の枠が狭いままになるだけ。
export const resetDisableAttempts = Effect.fnUntraced(function* (userId: string) {
  const ttlStore = yield* TtlStore;
  yield* ttlStore
    .delete(disableAttemptsKey(userId))
    .pipe(Effect.catchTag("TtlStoreError", captureCause({ tags: { component: COMPONENT } })));
});
