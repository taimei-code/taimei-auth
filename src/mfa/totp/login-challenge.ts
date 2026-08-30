import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { parse as parseCookieHeader, serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../../auth";
import { isLocalEnvironment } from "../../env";
import { redisStorage } from "../../redis";
import { Sentry } from "../../sentry";
import { spendAttemptBudget, type AttemptBudgetVerdict } from "../attempt-budget";

// ログインチャレンジの store (Redis 1 key) + 試行枠 + 自前署名 cookie (A-9)。
// 旧 challenge-store の 3 write 順序・better-call 署名 scheme のハードコピー・完了マーカー形式は
// 全て不要になった。単回消費は redisStorage.getAndDelete が atomic に確定する (ADR-0016)。

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
async function authSecret(): Promise<string> {
  return (await auth.$context).secret;
}

type ChallengeCookieAttributes = {
  maxAge: number;
  path: "/";
  httpOnly: true;
  sameSite: "Lax";
  secure: boolean;
};

export type LoginChallengeCookie = {
  name: string;
  value: string;
  attributes: ChallengeCookieAttributes;
};

// Domain を付けない (host-only) — 第二要素の材料を全 subdomain へ配らない。
const challengeCookieAttributes = (maxAge: number): ChallengeCookieAttributes => ({
  maxAge,
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
  secure: !isLocalEnvironment(),
});

// Redis write + cookie 素材。plugin は ctx.setCookie(name, value, attributes) で書く。
export async function buildLoginChallengeCookie(
  challenge: LoginChallenge,
): Promise<LoginChallengeCookie> {
  const challengeId = `mfa-lc-${crypto.randomUUID()}`;
  await redisStorage.set(
    challengeKey(challengeId),
    JSON.stringify(challenge),
    CHALLENGE_TTL_SECONDS,
  );
  const signature = await makeSignature(challengeId, await authSecret());
  return {
    name: LOGIN_CHALLENGE_COOKIE,
    value: `${challengeId}.${signature}`,
    attributes: challengeCookieAttributes(CHALLENGE_TTL_SECONDS),
  };
}

// テスト向け: Set-Cookie 1 本の Headers を返す (production は buildLoginChallengeCookie を使う)。
export async function issueLoginChallenge(challenge: LoginChallenge): Promise<Headers> {
  const cookie = await buildLoginChallengeCookie(challenge);
  const headers = new Headers();
  headers.append("set-cookie", serializeSetCookie(cookie.name, cookie.value, cookie.attributes));
  return headers;
}

// GET /api/mfa/challenge が返すのは boolean 1 つに限る (userId 等を未認証応答へ出さない)。
export async function readLoginChallengeState(headers: Headers): Promise<{ pending: boolean }> {
  return { pending: (await peekLoginChallenge(headers)) !== null };
}

// cookie 読み → HMAC 検証 → Redis get → JSON parse + 形の検証。どの段階の失敗も null (漏らさない)。
export async function peekLoginChallenge(headers: Headers): Promise<OpenedLoginChallenge | null> {
  const challengeId = await resolveChallengeId(headers);
  if (!challengeId) return null;
  const raw = await redisStorage.get(challengeKey(challengeId));
  const challenge = parseChallenge(raw);
  return challenge ? { ...challenge, challengeId } : null;
}

// getAndDelete が単回消費を atomic に確定する。false = 並行敗者 or 期限切れ。
// 値の形は発行側しか書かないため存在チェックで足りる (形の検証は peek の担当)。
export async function consumeLoginChallenge(
  challengeId: string,
): Promise<{ consumed: boolean; clearCookie: Headers }> {
  const raw = await redisStorage.getAndDelete(challengeKey(challengeId));
  return { consumed: raw !== null, clearCookie: clearCookieHeaders() };
}

export async function destroyLoginChallenge(challengeId: string): Promise<Headers> {
  await redisStorage.delete(challengeKey(challengeId));
  return clearCookieHeaders();
}

export type LoginChallengeAttempt = AttemptBudgetVerdict;

// fail-closed の計数 kernel は attempt-budget.ts と共有。上限到達はロック急増の唯一の検知信号
// なので Sentry warning に載せる (§8.2)。
export async function spendLoginChallengeAttempt(
  challengeId: string,
): Promise<LoginChallengeAttempt> {
  const verdict = await spendAttemptBudget({
    key: attemptsKey(challengeId),
    windowSeconds: CHALLENGE_TTL_SECONDS,
    max: MAX_ATTEMPTS,
    component: "mfa-login-challenge",
  });
  if (verdict === "exhausted") {
    Sentry.captureMessage("mfa: login challenge attempt budget exhausted", {
      level: "warning",
      tags: { component: "mfa-login-challenge" },
    });
  }
  return verdict;
}

function parseChallenge(raw: string | null): LoginChallenge | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { userId, redirectUrl, method } = parsed as Record<string, unknown>;
  if (typeof userId !== "string" || userId === "") return null;
  if (typeof redirectUrl !== "string") return null;
  const known = CHALLENGE_METHODS.find((candidate) => candidate === method);
  return known ? { userId, redirectUrl, method: known } : null;
}

function clearCookieHeaders(): Headers {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    serializeSetCookie(LOGIN_CHALLENGE_COOKIE, "", challengeCookieAttributes(0)),
  );
  return headers;
}

async function resolveChallengeId(headers: Headers): Promise<string | null> {
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
  return constantTimeEqual(signature, await makeSignature(challengeId, await authSecret()))
    ? challengeId
    : null;
}
