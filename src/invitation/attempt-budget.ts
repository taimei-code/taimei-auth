import { Clock, Effect } from "effect";
import { ATTEMPT_BUDGETS, spendAttemptBudgetOrRateLimited } from "../attempt-budget";

const HOUR_BUCKET_LENGTH = "YYYY-MM-DDTHH".length;

const hourBucket = (nowMillis: number): string =>
  new Date(nowMillis).toISOString().slice(0, HOUR_BUCKET_LENGTH);

export const spendInvitationAttempt = Effect.fnUntraced(function* (companyId: string) {
  const nowMillis = yield* Clock.currentTimeMillis;
  yield* spendAttemptBudgetOrRateLimited(
    ATTEMPT_BUDGETS.invitationsPerCompanyHour,
    `${companyId}:${hourBucket(nowMillis)}`,
  );
});
