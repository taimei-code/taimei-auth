import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, MiddlewareHandler } from "hono";
import { spendAttemptBudget } from "./attempt-budget";
import { runMiddleware } from "./handlers/run-route";
import { JSON_HEADERS } from "./handlers/client-facing-error";

export type RateLimitOptions = {
  keyFn: (c: Context) => string | Promise<string>;
  limit: number;
  windowSec: number;
};

export const magicLinkKey = (axis: "ip" | "email", id: string): string =>
  `rate-limit:magic-link:${axis}:${id}`;

// session 軸は IP を変えても同じ枠で数えるため。hash はキー名が有効な認証情報にならないようにするため。
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

// INCR のたびに EXPIRE するため、Retry-After は常に windowSec になる。
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
