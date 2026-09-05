import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, MiddlewareHandler } from "hono";
import { runMiddleware } from "./handlers/run-route";
import { Redis } from "./redis-service";
import { captureCause } from "./sentry";

export type RateLimitOptions = {
  keyFn: (c: Context) => string | Promise<string>;
  limit: number;
  windowSec: number;
};

export const magicLinkKey = (axis: "ip" | "email", id: string): string =>
  `rate-limit:magic-link:${axis}:${id}`;

// MFA 状態変更を数える軸。セッションあり経路にプラグインの試行制限が継承されないため誤コード連投の歯止めは
// ここだけ。軸を IP でなくセッションに取るのは cookie を盗んだ攻撃者が IP を変えても同じ枠に載せるため。
// token をそのままキー名にしないのは、キー名が Redis 上に残る有効な認証情報になってしまうから。
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

// Redis 障害時は fail-open (auth は事業 critical path、availability を優先)。RedisError は Sentry (warning) に残す。
// EXPIRE を毎回呼ぶため「最後の req から windowSec」semantic になる (固定 window ではない — 差は許容)。
// 本体は Effect program (Redis service 経由)、runMiddleware が Response → 短絡 / undefined → next() に写像する。
export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  return (c, next) =>
    runMiddleware(
      c,
      next,
      Effect.gen(function* () {
        const redis = yield* Redis;
        const key = yield* Effect.promise(async () => options.keyFn(c));
        const result = yield* redis
          .incrementRateWindow(key, options.windowSec)
          .pipe(
            Effect.catchTag("RedisError", (failure) =>
              captureCause({ level: "warning", tags: { component: "rate-limit" } })(failure).pipe(
                Effect.as(null),
              ),
            ),
          );
        if (!result) return undefined;
        const { count, ttl } = result;
        if (count > options.limit) {
          return c.json({ error: "Too Many Requests" }, 429, {
            "Retry-After": String(Math.max(ttl, 1)),
          });
        }
        return undefined;
      }),
    );
}
