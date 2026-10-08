import { Data, Effect } from "effect";
import { TtlStore } from "./ttl-store-service";
import { captureCauseAs } from "./sentry";

export class AttemptBudgetExhausted extends Data.TaggedError("AttemptBudgetExhausted") {}

export class AttemptBudgetUnavailable extends Data.TaggedError("AttemptBudgetUnavailable") {}

type AttemptBudget = {
  key: string;
  windowSeconds: number;
  maxAttempts: number;
  component: string;
};

export const spendAttemptBudgetFailClosed = Effect.fnUntraced(function* (input: AttemptBudget) {
  const ttlStore = yield* TtlStore;
  const counted = yield* ttlStore.incrementRateWindow(input.key, input.windowSeconds).pipe(
    Effect.filterOrFail(
      (result) => result.count >= 1,
      (result) => ({
        cause: new Error(`incrementRateWindow: 応答が契約に外れる (count=${result.count})`),
      }),
    ),
    Effect.catch(captureCauseAs(null, { tags: { component: input.component } })),
  );
  if (!counted) return yield* new AttemptBudgetUnavailable();
  if (counted.count > input.maxAttempts) return yield* new AttemptBudgetExhausted();
  return { attemptsLeft: input.maxAttempts - counted.count };
});

export const spendAttemptBudgetFailOpen = Effect.fnUntraced(
  function* (input: AttemptBudget) {
    yield* spendAttemptBudgetFailClosed(input);
  },
  Effect.catchTag("AttemptBudgetUnavailable", () => Effect.void),
);
