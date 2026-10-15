import { getSessionCookie } from "better-auth/cookies";
import { Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import {
  ATTEMPT_BUDGETS,
  type AttemptBudget,
  spendAttemptBudgetOrRateLimited,
} from "../attempt-budget";
import { ChallengeStateBudget, ChallengeVerifyBudget, MfaChangeBudget } from "../mfa/mfa-contract";
import { getClientContext } from "../request-context";
import type { SentryService } from "../sentry";
import type { TtlStore } from "../ttl-store-service";
import { headersOf } from "./request-http-api";

export async function mfaAttemptSubject(headers: Headers, fallbackIp: string): Promise<string> {
  const sessionToken = getSessionCookie(headers);
  if (!sessionToken) return `ip:${fallbackIp}`;
  return `session:${await sha256Hex(sessionToken)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const budgetMiddleware = (
  budget: AttemptBudget<"allow">,
  subjectOf: (headers: Headers, ip: string) => string | Promise<string>,
): Effect.Effect<MfaChangeBudget["Service"], never, TtlStore | SentryService> =>
  Effect.gen(function* () {
    const services = yield* Effect.context<TtlStore | SentryService>();
    return Effect.fnUntraced(function* (httpEffect) {
      const headers = headersOf(yield* HttpServerRequest.HttpServerRequest);
      const subject = yield* Effect.promise(async () =>
        subjectOf(headers, getClientContext(headers).ip),
      );
      yield* spendAttemptBudgetOrRateLimited(budget, subject).pipe(Effect.provideContext(services));
      return yield* httpEffect;
    });
  });

export const AttemptBudgetsLive = Layer.mergeAll(
  Layer.effect(
    ChallengeVerifyBudget,
    budgetMiddleware(ATTEMPT_BUDGETS.mfaChallengeVerifyPerIp, (_headers, ip) => ip),
  ),
  Layer.effect(
    ChallengeStateBudget,
    budgetMiddleware(ATTEMPT_BUDGETS.mfaChallengeStatePerIp, (_headers, ip) => ip),
  ),
  Layer.effect(
    MfaChangeBudget,
    budgetMiddleware(ATTEMPT_BUDGETS.mfaChangePerSession, mfaAttemptSubject),
  ),
);
