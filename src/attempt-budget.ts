import { Effect } from "effect";
import { TtlStore } from "./ttl-store-service";
import { captureCauseAs } from "./sentry";

export const spendAttemptBudget = Effect.fn("attemptBudget.spend")(function* (input: {
  key: string;
  windowSeconds: number;
  maxAttempts: number;
  component: string;
}) {
  const ttlStore = yield* TtlStore;
  const counted = yield* ttlStore
    .incrementRateWindow(input.key, input.windowSeconds)
    .pipe(
      Effect.catchTag(
        "TtlStoreError",
        captureCauseAs(null, { tags: { component: input.component } }),
      ),
    );
  // 契約に外れた 0 や NaN を accepted にしない (throw する側は ttl-store.ts)。
  if (!counted || !(counted.count >= 1)) return "unavailable" as const;
  return counted.count > input.maxAttempts ? ("exhausted" as const) : ("accepted" as const);
});
