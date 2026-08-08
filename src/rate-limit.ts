import type { Context, MiddlewareHandler } from "hono";
import { incrementRateWindow } from "./redis";
import { Sentry } from "./sentry";

export type RateLimitOptions = {
  keyFn: (c: Context) => string | Promise<string>;
  limit: number;
  windowSec: number;
};

export const magicLinkKey = (axis: "ip" | "email", id: string): string =>
  `rate-limit:magic-link:${axis}:${id}`;

// Redis 障害時は fail-open (auth は事業 critical path、availability を優先)。Sentry capture で可観測性確保。
// EXPIRE を毎回呼ぶことで「最後の req から windowSec」semantic になる (固定 window ではない)
// — Magic Link 5 分有効と比べて数十秒の差は本質影響なしとして許容。厳密固定 window が必要に
// なれば Lua script で INCR 時に EXPIRE 条件分岐を移す。
export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = await options.keyFn(c);
    const result = await incrementRateWindow(key, options.windowSec).catch((error) => {
      Sentry.captureException(error, { tags: { component: "rate-limit" } });
      return null;
    });
    if (!result) return next();
    const { count, ttl } = result;
    if (count > options.limit) {
      return c.json({ error: "Too Many Requests" }, 429, {
        "Retry-After": String(Math.max(ttl, 1)),
      });
    }
    return next();
  };
}
