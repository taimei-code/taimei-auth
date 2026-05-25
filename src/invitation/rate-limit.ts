import { redis } from "../redis";
import { Sentry } from "../sentry";

// ADR-009: company 単位の invitation rate limit。既存 Magic Link rate limit と独立した二重防御。
// 法人 30 人入社等の legitimate burst を見越し default 50/h/company (env tunable)。
function hourlyLimit(): number {
  const raw = Number(process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

// INCR + EXPIRE 1h を MULTI で atomic 化 (rate-limit.ts と同方針)。
// Redis 障害時は fail-open (招待は critical path ではないが availability を優先)。
// 上限内なら true、超過なら false を返す。
export async function incrInvitationRate(companyId: string): Promise<boolean> {
  const key = `invitation_rate:${companyId}:${currentHourBucket()}`;
  const results = await redis
    .multi()
    .incr(key)
    .expire(key, 3600)
    .exec()
    .catch((error) => {
      Sentry.captureException(error, { tags: { component: "invitation-rate-limit" } });
      return null;
    });
  if (!results) return true; // fail-open
  const count = Number(results[0] ?? 0);
  return count <= hourlyLimit();
}

function currentHourBucket(): string {
  return new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
}
