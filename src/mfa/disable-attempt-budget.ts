import { Effect } from "effect";
import { TtlStore } from "../ttl-store-service";
import { captureCause } from "../sentry";
import { spendAttemptBudget } from "../attempt-budget";
import { Locked } from "./error-mapping";

// セッションあり経路で 6 桁の総当たりを止める唯一の防御。

const disableAttemptsKey = (userId: string): string => `mfa:disable-attempts:${userId}`;

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const COMPONENT = "mfa-disable-attempt-budget";

export const spendDisableAttempt = Effect.fn("mfa.spendDisableAttempt")(function* (userId: string) {
  const verdict = yield* spendAttemptBudget({
    key: disableAttemptsKey(userId),
    windowSeconds: WINDOW_SECONDS,
    maxAttempts: MAX_ATTEMPTS,
    component: COMPONENT,
  });
  if (verdict !== "accepted") return yield* new Locked();
});

// 消し損ねても止めない — 残った counter は TTL で消え、影響は次の枠が狭いままに留まる。
export const resetDisableAttempts = Effect.fn("mfa.resetDisableAttempts")(function* (
  userId: string,
) {
  const ttlStore = yield* TtlStore;
  yield* ttlStore
    .delete(disableAttemptsKey(userId))
    .pipe(Effect.catchTag("TtlStoreError", captureCause({ tags: { component: COMPONENT } })));
});
