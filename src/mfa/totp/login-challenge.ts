import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { Effect } from "effect";
import { parse as parseCookieHeader, serialize as serializeSetCookie } from "hono/utils/cookie";
import { z } from "zod";
import { auth } from "../../auth";
import { isLocalEnvironment } from "../../env";
import { tryAuthApi } from "../../errors";
import { TtlStore } from "../../ttl-store-service";
import { SentryService } from "../../sentry";
import { spendAttemptBudget } from "../../attempt-budget";
import { ChallengeExpired } from "../error-mapping";

const LOGIN_CHALLENGE_COOKIE = "mfa_login_challenge";

const CHALLENGE_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

export const challengeKey = (challengeId: string): string => `mfa:login-challenge:${challengeId}`;
export const attemptsKey = (challengeId: string): string =>
  `mfa:login-challenge-attempts:${challengeId}`;

const CHALLENGE_METHODS = ["magic_link", "github"] as const;
export type ChallengeMethod = (typeof CHALLENGE_METHODS)[number];

type LoginChallenge = { userId: string; redirectUrl: string; method: ChallengeMethod };
type OpenedLoginChallenge = LoginChallenge & { challengeId: string };

// 鍵は better-auth の解決を通す — env 直読みだと dev/CI の default fallback で session 側とずれる。
const signChallengeId = Effect.fn("mfa.signChallengeId")(function* (challengeId: string) {
  const secret = yield* tryAuthApi(async () => (await auth.$context).secret);
  return yield* Effect.promise(() => makeSignature(challengeId, secret));
});

// Domain を付けない (host-only) — 第二要素の材料を全 subdomain へ配らない。
const challengeCookieAttributes = (maxAge: number) =>
  ({
    maxAge,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: !isLocalEnvironment(),
  }) as const;

export type LoginChallengeCookie = {
  name: string;
  value: string;
  attributes: ReturnType<typeof challengeCookieAttributes>;
};

export const openLoginChallenge = Effect.fn("mfa.openLoginChallenge")(function* (
  challenge: LoginChallenge,
) {
  const challengeId = `mfa-lc-${crypto.randomUUID()}`;
  yield* TtlStore.use((r) =>
    r.set(challengeKey(challengeId), JSON.stringify(challenge), CHALLENGE_TTL_SECONDS),
  );
  const signature = yield* signChallengeId(challengeId);
  return {
    name: LOGIN_CHALLENGE_COOKIE,
    value: `${challengeId}.${signature}`,
    attributes: challengeCookieAttributes(CHALLENGE_TTL_SECONDS),
  } satisfies LoginChallengeCookie;
});

// 未認証応答へ出すのは boolean 1 つに限る (userId 等を出さない)。
export const readLoginChallengeState = Effect.fn("mfa.readLoginChallengeState")(function* (
  headers: Headers,
) {
  return { pending: (yield* peekLoginChallenge(headers)) !== null };
});

export const peekLoginChallenge = Effect.fn("mfa.peekLoginChallenge")(function* (headers: Headers) {
  const challengeId = yield* resolveChallengeId(headers);
  if (!challengeId) return null;
  const raw = yield* TtlStore.use((r) => r.get(challengeKey(challengeId)));
  const challenge = parseChallenge(raw);
  return challenge ? ({ ...challenge, challengeId } satisfies OpenedLoginChallenge) : null;
});

export const consumeLoginChallenge = Effect.fn("mfa.consumeLoginChallenge")(function* (
  challengeId: string,
) {
  const raw = yield* TtlStore.use((r) => r.getAndDelete(challengeKey(challengeId)));
  if (raw === null) return yield* new ChallengeExpired();
  return clearCookieHeaders();
});

// 失効指示 cookie は返さない — 呼び出し側は応答を invalid_code のままにする契約。
export const destroyLoginChallenge = Effect.fn("mfa.destroyLoginChallenge")(function* (
  challengeId: string,
) {
  yield* TtlStore.use((r) => r.delete(challengeKey(challengeId)));
});

// 上限到達を Sentry へ出すのがロック急増の唯一の検知信号。
export const spendLoginChallengeAttempt = Effect.fn("mfa.spendLoginChallengeAttempt")(function* (
  challengeId: string,
) {
  const verdict = yield* spendAttemptBudget({
    key: attemptsKey(challengeId),
    windowSeconds: CHALLENGE_TTL_SECONDS,
    maxAttempts: MAX_ATTEMPTS,
    component: "mfa-login-challenge",
  });
  if (verdict === "exhausted") {
    yield* SentryService.use((sentry) =>
      sentry.captureMessage("mfa: login challenge attempt budget exhausted", {
        level: "warning",
        tags: { component: "mfa-login-challenge" },
      }),
    );
  }
  return verdict;
});

const challengeSchema = z.object({
  userId: z.string().min(1),
  redirectUrl: z.string(),
  method: z.enum(CHALLENGE_METHODS),
});

function parseChallenge(raw: string | null): LoginChallenge | null {
  if (!raw) return null;
  try {
    return challengeSchema.safeParse(JSON.parse(raw)).data ?? null;
  } catch {
    return null;
  }
}

function clearCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    serializeSetCookie(LOGIN_CHALLENGE_COOKIE, "", challengeCookieAttributes(0)),
  );
  return headers;
}

const resolveChallengeId = Effect.fn("mfa.resolveChallengeId")(function* (headers: Headers) {
  const raw = parseCookieHeader(headers.get("cookie") ?? "", LOGIN_CHALLENGE_COOKIE)[
    LOGIN_CHALLENGE_COOKIE
  ];
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator < 1) return null;
  const challengeId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  return constantTimeEqual(signature, yield* signChallengeId(challengeId)) ? challengeId : null;
});
