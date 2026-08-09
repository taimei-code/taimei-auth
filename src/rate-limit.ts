import { getSessionCookie } from "better-auth/cookies";
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

// MFA の状態変更 (enroll / activate / disable) を数える軸。セッションあり経路にプラグインの試行制限が
// 継承されない (根拠は src/mfa/disable.ts) ため、誤コード連投の歯止めはここだけ。軸を IP でなく
// セッションに取るのは、cookie を盗んだ攻撃者が IP を変えても同じ枠に載せるため。token をそのまま
// キー名にしないのは、キー名が Redis 上に残る有効な認証情報になってしまうから。
export async function mfaAttemptKey(headers: Headers, fallbackIp: string): Promise<string> {
  const sessionToken = getSessionCookie(headers);
  if (!sessionToken) return `rate-limit:mfa-attempt:ip:${fallbackIp}`;
  return `rate-limit:mfa-attempt:session:${await sha256Hex(sessionToken)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
