import { Effect } from "effect";
import { TtlStore } from "./ttl-store-service";
import { captureCauseAs } from "./sentry";

// 数えられなければ unavailable を返す。fail-closed と fail-open のどちらにするかは呼び出し側が決める (CONTEXT.md「試行枠」)。

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
  // 2 段目の防御として、契約に外れた 0 や NaN を accepted にせず unavailable として扱う (throw する側の定義は ttl-store.ts)
  if (!counted || !(counted.count >= 1)) return "unavailable" as const;
  return counted.count > input.maxAttempts ? ("exhausted" as const) : ("accepted" as const);
});
