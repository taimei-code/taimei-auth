import { Clock, Effect } from "effect";
import { Redis } from "../redis-service";
import { captureCause } from "../sentry";

// company 単位の invitation rate limit。Magic Link rate limit と独立した二重防御 (一括入社の burst を見越した既定値)。
const DEFAULT_HOURLY_LIMIT_PER_COMPANY = 50;

const HOUR_BUCKET_TTL_SEC = 60 * 60;

const HOUR_BUCKET_LENGTH = "YYYY-MM-DDTHH".length;

function hourlyLimit(): number {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOURLY_LIMIT_PER_COMPANY;
}

// Redis 障害時は fail-open (availability 優先)。MULTI で atomic 化する根拠は src/rate-limit.ts に集約。
// RedisError だけを握って true に倒すため E は never で、呼び出し側は障害の分岐を持たない。
export const tryConsumeInvitationQuota = Effect.fn("invitation.tryConsumeQuota")(function* (
  companyId: string,
) {
  const redis = yield* Redis;
  const nowMillis = yield* Clock.currentTimeMillis;
  const key = `invitation_rate:${companyId}:${hourBucket(nowMillis)}`;
  return yield* redis.incrementRateWindow(key, HOUR_BUCKET_TTL_SEC).pipe(
    Effect.map((result) => result.count <= hourlyLimit()),
    Effect.catchTag("RedisError", (failure) =>
      captureCause({ tags: { component: "invitation-rate-limit" } })(failure).pipe(Effect.as(true)),
    ),
  );
});

function hourBucket(nowMillis: number): string {
  return new Date(nowMillis).toISOString().slice(0, HOUR_BUCKET_LENGTH);
}
