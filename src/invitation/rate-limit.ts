import { incrementRateWindow } from "../redis";
import { Sentry } from "../sentry";

// ADR-009: company 単位の invitation rate limit。既存 Magic Link rate limit と独立した二重防御。
// 法人 30 人入社等の legitimate burst を見越した既定値。
const DEFAULT_HOURLY_LIMIT_PER_COMPANY = 50;

const HOUR_BUCKET_TTL_SEC = 60 * 60;

const HOUR_BUCKET_LENGTH = "YYYY-MM-DDTHH".length;

function hourlyLimit(): number {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HOURLY_LIMIT_PER_COMPANY;
}

// Redis 障害時は fail-open (招待は critical path ではないが availability を優先)。
// INCR + EXPIRE を MULTI で atomic 化する根拠は src/rate-limit.ts に集約。
export async function tryConsumeInvitationQuota(companyId: string): Promise<boolean> {
  const key = `invitation_rate:${companyId}:${currentHourBucket()}`;
  const result = await incrementRateWindow(key, HOUR_BUCKET_TTL_SEC).catch((error) => {
    Sentry.captureException(error, { tags: { component: "invitation-rate-limit" } });
    return null;
  });
  if (!result) return true; // fail-open
  return result.count <= hourlyLimit();
}

function currentHourBucket(): string {
  return new Date().toISOString().slice(0, HOUR_BUCKET_LENGTH);
}
