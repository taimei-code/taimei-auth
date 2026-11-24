import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { CurrentSession } from "../account/actor-contract";
import {
  ATTEMPT_BUDGETS,
  type AttemptBudget,
  spendAttemptBudgetOrRateLimited,
} from "../attempt-budget";
import { ChallengeStateBudget, ChallengeVerifyBudget, MfaChangeBudget } from "../mfa/mfa-contract";
import { PasskeyManagementBudget, PasskeySignInBudget } from "../passkey/passkey-contract";
import { getClientContext } from "../request-context";
import type { SentryService } from "../sentry";
import type { TtlStore } from "../ttl-store-service";
import { headersOf } from "./request-http-api";

const perIpBudget = (
  budget: AttemptBudget<"allow">,
  subjectOf: (ip: string, endpoint: string) => string,
): Effect.Effect<ChallengeVerifyBudget["Service"], never, TtlStore | SentryService> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<TtlStore | SentryService>();
    return Effect.fnUntraced(function* (httpEffect, { endpoint }) {
      const headers = headersOf(yield* HttpServerRequest.HttpServerRequest);
      const subject = subjectOf(getClientContext(headers).ip, endpoint.identifier);
      yield* spendAttemptBudgetOrRateLimited(budget, subject).pipe(Effect.provideContext(services));
      return yield* httpEffect;
    });
  });

const perSessionBudget = (
  budget: AttemptBudget<"allow">,
): Effect.Effect<MfaChangeBudget["Service"], never, TtlStore | SentryService> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<TtlStore | SentryService>();
    return Effect.fnUntraced(function* (httpEffect) {
      const session = yield* CurrentSession;
      yield* spendAttemptBudgetOrRateLimited(budget, `session:${session.id}`).pipe(
        Effect.provideContext(services),
      );
      return yield* httpEffect;
    });
  });

export const AttemptBudgetsLive = Layer.mergeAll(
  Layer.effect(
    ChallengeVerifyBudget,
    perIpBudget(ATTEMPT_BUDGETS.mfaChallengeVerifyPerIp, (ip) => ip),
  ),
  Layer.effect(
    ChallengeStateBudget,
    perIpBudget(ATTEMPT_BUDGETS.mfaChallengeStatePerIp, (ip) => ip),
  ),
  Layer.effect(MfaChangeBudget, perSessionBudget(ATTEMPT_BUDGETS.mfaChangePerSession)),
  Layer.effect(
    PasskeyManagementBudget,
    perSessionBudget(ATTEMPT_BUDGETS.passkeyManagementPerSession),
  ),
  Layer.effect(
    PasskeySignInBudget,
    perIpBudget(ATTEMPT_BUDGETS.passkeySignInPerIp, (ip, endpoint) => `${endpoint}:${ip}`),
  ),
);
