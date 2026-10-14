import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { spendAttemptBudgetFailOpen } from "../attempt-budget";
import { RateLimited } from "../membership/guard/errors";
import { ChallengeStateBudget, ChallengeVerifyBudget, MfaChangeBudget } from "../mfa/mfa-contract";
import { limitForEnvironment, mfaAttemptKey } from "../rate-limit";
import { getClientContext } from "../request-context";
import type { SentryService } from "../sentry";
import type { TtlStore } from "../ttl-store-service";
import { headersOf } from "./request-http-api";

const WINDOW_SECONDS = 60;

type Budget = {
  readonly keyOf: (headers: Headers, ip: string) => string | Promise<string>;
  readonly limit: number;
};

const budgetMiddleware = (
  budget: Budget,
): Effect.Effect<MfaChangeBudget["Service"], never, TtlStore | SentryService> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<TtlStore | SentryService>();
    return Effect.fnUntraced(function* (httpEffect) {
      const headers = headersOf(yield* HttpServerRequest.HttpServerRequest);
      const key = yield* Effect.promise(async () =>
        budget.keyOf(headers, getClientContext(headers).ip),
      );
      yield* spendAttemptBudgetFailOpen({
        key,
        windowSeconds: WINDOW_SECONDS,
        maxAttempts: limitForEnvironment(budget.limit),
        component: "rate-limit",
      }).pipe(
        Effect.catchTag("AttemptBudgetExhausted", () => new RateLimited()),
        Effect.provideContext(services),
      );
      return yield* httpEffect;
    });
  });

export const AttemptBudgetsLive = Layer.mergeAll(
  Layer.effect(
    ChallengeVerifyBudget,
    budgetMiddleware({ keyOf: (_headers, ip) => `rate-limit:mfa-challenge:ip:${ip}`, limit: 10 }),
  ),
  Layer.effect(
    ChallengeStateBudget,
    budgetMiddleware({
      keyOf: (_headers, ip) => `rate-limit:mfa-challenge-status:ip:${ip}`,
      limit: 30,
    }),
  ),
  Layer.effect(MfaChangeBudget, budgetMiddleware({ keyOf: mfaAttemptKey, limit: 10 })),
);
