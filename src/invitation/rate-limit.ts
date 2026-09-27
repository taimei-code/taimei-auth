import { Clock, Effect } from "effect";
import { spendAttemptBudgetFailOpen } from "../attempt-budget";
import { RateLimited } from "./errors";

const DEFAULT_HOURLY_LIMIT_PER_COMPANY = 50;

const HOUR_BUCKET_TTL_SEC = 60 * 60;

const HOUR_BUCKET_LENGTH = "YYYY-MM-DDTHH".length;

function hourlyLimit(): number {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOURLY_LIMIT_PER_COMPANY;
}

export const consumeInvitationQuota = Effect.fn("invitation.consumeQuota")(
  function* (companyId: string) {
    const nowMillis = yield* Clock.currentTimeMillis;
    yield* spendAttemptBudgetFailOpen({
      key: `invitation_rate:${companyId}:${hourBucket(nowMillis)}`,
      windowSeconds: HOUR_BUCKET_TTL_SEC,
      maxAttempts: hourlyLimit(),
      component: "invitation-rate-limit",
    });
  },
  Effect.catchTag("AttemptBudgetExhausted", () => new RateLimited()),
);

function hourBucket(nowMillis: number): string {
  return new Date(nowMillis).toISOString().slice(0, HOUR_BUCKET_LENGTH);
}
