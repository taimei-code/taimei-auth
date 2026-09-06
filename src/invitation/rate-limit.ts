import { Clock, Effect } from "effect";
import { spendAttemptBudget } from "../attempt-budget";

// company 単位の invitation rate limit。Magic Link rate limit と独立した二重防御 (一括入社の burst を見越した既定値)。
const DEFAULT_HOURLY_LIMIT_PER_COMPANY = 50;

const HOUR_BUCKET_TTL_SEC = 60 * 60;

const HOUR_BUCKET_LENGTH = "YYYY-MM-DDTHH".length;

function hourlyLimit(): number {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOURLY_LIMIT_PER_COMPANY;
}

// 倒し方は fail-open (根拠: CONTEXT.md「fail-closed / fail-open」)。計数は試行枠 kernel に乗せ、数えられなかった
// verdict (unavailable) も通す。kernel が RedisError を畳むため E は never で、呼び出し側は障害の分岐を持たない。
export const tryConsumeInvitationQuota = Effect.fn("invitation.tryConsumeQuota")(function* (
  companyId: string,
) {
  const nowMillis = yield* Clock.currentTimeMillis;
  const verdict = yield* spendAttemptBudget({
    key: `invitation_rate:${companyId}:${hourBucket(nowMillis)}`,
    windowSeconds: HOUR_BUCKET_TTL_SEC,
    maxAttempts: hourlyLimit(),
    component: "invitation-rate-limit",
  });
  return verdict === "accepted" || verdict === "unavailable";
});

function hourBucket(nowMillis: number): string {
  return new Date(nowMillis).toISOString().slice(0, HOUR_BUCKET_LENGTH);
}
