import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { Effect } from "effect";
import { parse as parseCookieHeader, serialize as serializeSetCookie } from "hono/utils/cookie";
import { z } from "zod";
import { auth } from "../../auth";
import { isLocalEnvironment } from "../../env";
import { tryAuthApi } from "../../errors";
import { Redis } from "../../redis-service";
import { SentryService } from "../../sentry";
import { spendAttemptBudget } from "../../attempt-budget";

// ログインチャレンジの store (Redis 1 key) + 試行枠 + 自前署名 cookie (A-9)。
// 旧 challenge-store の 3 write 順序・better-call 署名 scheme のハードコピー・完了マーカー形式は
// 全て不要になった。単回消費は redisStorage.getAndDelete が atomic に確定する (ADR-0016)。
// Redis 障害は RedisError (boundary、Sentry warning + 500) として E channel に載せる — 試行枠だけは
// fail-closed のため attempt-budget が畳む。

export const LOGIN_CHALLENGE_COOKIE = "mfa_login_challenge";

const CHALLENGE_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

// export しているのは、テストが期限切れ・掃除の操作対象を production と同じキーに固定するため
// (disable-attempt-budget.ts の disableAttemptsKey と同じ規律)。
export const challengeKey = (challengeId: string): string => `mfa:login-challenge:${challengeId}`;
export const attemptsKey = (challengeId: string): string =>
  `mfa:login-challenge-attempts:${challengeId}`;

const CHALLENGE_METHODS = ["magic_link", "github"] as const;
export type ChallengeMethod = (typeof CHALLENGE_METHODS)[number];

export type LoginChallenge = { userId: string; redirectUrl: string; method: ChallengeMethod };
export type OpenedLoginChallenge = LoginChallenge & { challengeId: string };

// cookie 署名鍵は AUTH_SECRET を共有する — cookie 署名は AUTH_SECRET の本来用途と同クラスで、
// 差し替え時の影響は保留中チャレンジ (最大 600 秒) の失効だけ (専用鍵は不採用: ADR-0016)。
// env 直読みでなく better-auth の解決 (dev の default fallback を含む) に合わせる — 旧構成と同じ
// 供給網に乗せ、AUTH_SECRET 未設定の dev/CI で session 側と鍵がずれないようにする。
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

// Redis write + cookie 素材。plugin は ctx.setCookie(name, value, attributes) で書く。
export const openLoginChallenge = Effect.fn("mfa.openLoginChallenge")(function* (
  challenge: LoginChallenge,
) {
  const challengeId = `mfa-lc-${crypto.randomUUID()}`;
  const redis = yield* Redis;
  yield* redis.set(challengeKey(challengeId), JSON.stringify(challenge), CHALLENGE_TTL_SECONDS);
  const signature = yield* signChallengeId(challengeId);
  return {
    name: LOGIN_CHALLENGE_COOKIE,
    value: `${challengeId}.${signature}`,
    attributes: challengeCookieAttributes(CHALLENGE_TTL_SECONDS),
  } satisfies LoginChallengeCookie;
});

// better-auth の after-hook (src/auth-plugins/mfa-challenge.ts) は Promise / throw 契約 (ADR-0017 の物理境界)
// なので、ここが Effect と Promise の境界になる。失敗は reject のまま返し、hook 側の
// fail-closed (catch → チャレンジ画面へ) を保つ。
// runtime は関数内で動的 import する (auth.ts から静的に辿れる module の規則: src/CLAUDE.md「Effect様式」)。
export const buildLoginChallengeCookie = async (
  challenge: LoginChallenge,
): Promise<LoginChallengeCookie> => {
  const { getRuntime } = await import("../../runtime");
  return getRuntime().runPromise(openLoginChallenge(challenge));
};

// GET /api/mfa/challenge が返すのは boolean 1 つに限る (userId 等を未認証応答へ出さない)。
export const readLoginChallengeState = Effect.fn("mfa.readLoginChallengeState")(function* (
  headers: Headers,
) {
  return { pending: (yield* peekLoginChallenge(headers)) !== null };
});

// cookie 読み → HMAC 検証 → Redis get → JSON parse + 形の検証。どの段階の失敗も null (漏らさない)。
export const peekLoginChallenge = Effect.fn("mfa.peekLoginChallenge")(function* (headers: Headers) {
  const challengeId = yield* resolveChallengeId(headers);
  if (!challengeId) return null;
  const raw = yield* (yield* Redis).get(challengeKey(challengeId));
  const challenge = parseChallenge(raw);
  return challenge ? ({ ...challenge, challengeId } satisfies OpenedLoginChallenge) : null;
});

// getAndDelete が単回消費を atomic に確定する。false = 並行敗者 or 期限切れ。
// 値の形は発行側しか書かないため存在チェックで足りる (形の検証は peek の担当)。
export const consumeLoginChallenge = Effect.fn("mfa.consumeLoginChallenge")(function* (
  challengeId: string,
) {
  const raw = yield* (yield* Redis).getAndDelete(challengeKey(challengeId));
  return { consumed: raw !== null, clearCookie: clearCookieHeaders() };
});

// 失効指示 cookie は返さない — 呼び出し側は応答を invalid_code のままにする契約 (§9)。
export const destroyLoginChallenge = Effect.fn("mfa.destroyLoginChallenge")(function* (
  challengeId: string,
) {
  yield* (yield* Redis).delete(challengeKey(challengeId));
});

// 計数 kernel は attempt-budget.ts と共有。kernel は倒し方を持たないので、fail-closed (unavailable → Locked)
// は呼び手 complete-login-challenge.ts が verdict を写して決める。上限到達はロック急増の唯一の検知信号
// なので Sentry warning に載せる (§8.2)。
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
    yield* (yield* SentryService).captureMessage("mfa: login challenge attempt budget exhausted", {
      level: "warning",
      tags: { component: "mfa-login-challenge" },
    });
  }
  return verdict;
});

// 形の逸脱は例外でなく null に倒し、呼び出し側の「チャレンジ無し」と同じ扱いにする。
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
  // 署名 scheme の知識を verify 側に複製しない — 期待値を同じ makeSignature で再計算して
  // 定数時間比較する (どちらも better-auth の公開 export)。
  return constantTimeEqual(signature, yield* signChallengeId(challengeId)) ? challengeId : null;
});
