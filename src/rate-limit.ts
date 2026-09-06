import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, MiddlewareHandler } from "hono";
import { spendAttemptBudget } from "./attempt-budget";
import { runMiddleware } from "./handlers/run-route";
import { JSON_HEADERS } from "./handlers/wire-error";

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

// HTTP 経路の試行枠 (CONTEXT.md「試行枠」)。倒し方は fail-open (根拠: CONTEXT.md「fail-closed / fail-open」) で、
// kernel の unavailable は通す。Retry-After は windowSec: 計数は INCR ごとに EXPIRE を打つので残り TTL は常に
// windowSec に等しい (正本: redis.ts の MULTI 計数のコメント)。kernel は ttl を返さない。
// key の解決 (Hono Context) は middleware 側に置き、program は Hono 非依存にして test が Redis / Sentry の
// test Layer だけで fail-open と境界を観測できるようにする。
// middleware の options から keyFn を Hono Context で解決済みの key に置き換えた形。
type RateLimitInput = Omit<RateLimitOptions, "keyFn"> & { key: string };

export const rateLimitProgram = Effect.fn("rateLimit.check")(function* (input: RateLimitInput) {
  const verdict = yield* spendAttemptBudget({
    key: input.key,
    windowSeconds: input.windowSec,
    maxAttempts: input.limit,
    component: "rate-limit",
  });
  if (verdict !== "exhausted") return undefined;
  return new Response(JSON.stringify({ error: "Too Many Requests" }), {
    status: 429,
    headers: { ...JSON_HEADERS, "Retry-After": String(input.windowSec) },
  });
});

export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  return (c, next) =>
    runMiddleware(
      c,
      next,
      Effect.promise(async () => options.keyFn(c)).pipe(
        Effect.flatMap((key) =>
          rateLimitProgram({ key, limit: options.limit, windowSec: options.windowSec }),
        ),
      ),
    );
}
