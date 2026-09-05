import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { mfaRecoveryCode, mfaTotp } from "@/db/schema";
import { auth } from "../../auth";
import { withWaitUntil } from "../../background";
import { getRedis } from "../../redis";
import { resetDisableAttempts } from "../disable-attempt-budget";
import { activate, enroll } from "../totp";
import type { MfaTotpActor } from "../totp/contracts";
import {
  attemptsKey,
  buildLoginChallengeCookie,
  challengeKey,
  type ChallengeMethod,
} from "../totp/login-challenge";
import { runMfa, runMfaResult } from "./test-layers";

// MFA の DB/Redis 統合テストが共用する「本物のセッション・本物のチャレンジ・本物の TOTP」の組み立て。
// 状態を DB へ直接捏造すると、暗号化 secret とコードの対応が伴わず以降の検証がすべて偽陽性になる
// ため、生成はいずれも production と同じ経路 (internalAdapter / totp façade) を通す。

// テスト実行時の鍵 ring 既定値 (.env に無くても bun test が自走できるようにする)。
// 値は "0123456789abcdef0123456789abcdef" (32byte) の base64 — production と共有しない固定ダミー。
process.env.MFA_TOTP_ENCRYPTION_KEYS ??= "v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_USER_AGENT = "mfa-integration-test";

// src/mfa/totp/totp-engine.ts の PERIOD と同値。検証は独立実装 (@better-auth/utils) で行う (§10)。
const TOTP_PERIOD_SECONDS = 30;

export type { MfaTotpRow } from "@/db/repositories/mfa-totp";
import type { MfaTotpRow } from "@/db/repositories/mfa-totp";

// better-auth の署名付き cookie は `値.HMAC-SHA-256(値)` をパディング付き標準 base64 で載せる。
async function signCookieValue(value: string): Promise<string> {
  const { secret } = await auth.$context;
  return `${value}.${await makeSignature(value, secret)}`;
}

// 署名の**末尾**を書き換えても改ざんにならない。標準 base64 の最終文字は下位ビットがパディングで、
// atob が捨てるため復号後のバイト列が変わらず署名が通ってしまう。6 ビットすべてが有効な先頭文字を
// 差し替える。
export function tamperCookieSignature(signed: string): string {
  const separator = signed.lastIndexOf(".");
  const signature = signed.slice(separator + 1);
  const flippedHead = signature[0] === "A" ? "B" : "A";
  return `${signed.slice(0, separator)}.${flippedHead}${signature.slice(1)}`;
}

// ip / user-agent を常に載せ、audit payload の期待値が「未設定なら unknown」の分岐に落ちないようにする。
export function requestHeaders(cookies: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "user-agent": TEST_USER_AGENT,
    "x-forwarded-for": TEST_CLIENT_IP,
  });
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export type TestSession = { token: string; headers: Headers };

export async function sessionHeaders(token: string): Promise<Headers> {
  const { authCookies } = await auth.$context;
  return requestHeaders({ [authCookies.sessionToken.name]: await signCookieValue(token) });
}

// secondaryStorage 構成ではセッション実体が Redis にしか無く、DB へ session 行を挿しても
// getSession は解決できない。
export async function createSessionFor(userId: string): Promise<TestSession> {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);
  return { token: session.token, headers: await sessionHeaders(session.token) };
}

export async function issuedSessionCookieCount(forwarded: Headers): Promise<number> {
  const { authCookies } = await auth.$context;
  return issuedSessionCookieValues(forwarded, authCookies.sessionToken.name).length;
}

// 失効指示 (空値 / Max-Age=0) は「発行された cookie」に数えない。
function issuedSessionCookieValues(forwarded: Headers, cookieName: string): string[] {
  const prefix = `${cookieName}=`;
  return forwarded
    .getSetCookie()
    .filter((cookie) => cookie.startsWith(prefix) && !/max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.slice(prefix.length).split(";")[0])
    .filter((value) => value.lastIndexOf(".") > 0);
}

export function actorOf(user: { id: string; email: string }): MfaTotpActor {
  return { id: user.id, email: user.email };
}

// DB の secret 列は鍵 ring で暗号化されており、平文 secret を得る経路は enroll が返す otpauth URI
// (secret パラメータは平文の base32) だけ。secret は ASCII のため base32 → TextDecoder 往復互換。
export function secretFromTotpUri(totpUri: string): string {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`totp uri has no secret: ${totpUri}`);
  return new TextDecoder().decode(base32.decode(encoded));
}

export function totpCode(secret: string, stepOffset = 0): Promise<string> {
  const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: 6 });
  if (stepOffset === 0) return otp.totp();
  const counter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset;
  return otp.hotp(counter);
}

// 固定の誤コードは 6 桁の一様分布に対し窓 5 本ぶんの確率で偶然一致し、間欠的に緑になる。
// 窓の前後まで含めて実際に生成し、それらを避ける。
export async function wrongTotpCode(secret: string): Promise<string> {
  const rejected = await Promise.all([-2, -1, 0, 1, 2].map((offset) => totpCode(secret, offset)));
  for (let candidate = 0; candidate < 1000; candidate++) {
    const code = String(candidate).padStart(6, "0");
    if (!rejected.includes(code)) return code;
  }
  throw new Error("failed to find a code outside the verification window");
}

export function findMfaTotpRow(userId: string): Promise<MfaTotpRow | undefined> {
  return db
    .select()
    .from(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .then((rows) => rows.at(0));
}

export function countMfaTotpRows(userId: string): Promise<number> {
  return db
    .select()
    .from(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .then((rows) => rows.length);
}

export function countRecoveryCodeRows(userId: string): Promise<number> {
  return db
    .select()
    .from(mfaRecoveryCode)
    .where(eq(mfaRecoveryCode.userId, userId))
    .then((rows) => rows.length);
}

export type EnabledMfaUser = {
  actor: MfaTotpActor;
  /** 認証アプリが持つ値に相当する平文 TOTP secret。 */
  secret: string;
  recoveryCodes: string[];
  enrollmentId: string;
  /** 有効化後も同じセッションのまま (rotate は行わない — ADR-0016 §4.3)。 */
  session: TestSession;
};

export async function enableMfaFor(user: { id: string; email: string }): Promise<EnabledMfaUser> {
  const session = await createSessionFor(user.id);
  const actor = actorOf(user);
  const enrolled = await runMfaResult(enroll({ actor }));
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error}`);

  const secret = secretFromTotpUri(enrolled.totpUri);
  // 前 step のコードで有効化し、現 step 以降を後続の検証に残す (timestep は単調消費のため)。
  const activated = await runMfaResult(
    activate({
      actor,
      headers: session.headers,
      code: await totpCode(secret, -1),
      enrollmentId: enrolled.enrollmentId,
    }),
  );
  if (!activated.ok) throw new Error(`activate failed: ${activated.error}`);

  // 無効化の試行枠は user 単位で Redis に 15 分残るが、seed の user id は実行のたびに同じ。
  // 「有効化直後は枠が空」を fixture 側で保証する。
  await runMfa(resetDisableAttempts(user.id));

  return {
    actor,
    secret,
    recoveryCodes: enrolled.recoveryCodes,
    enrollmentId: enrolled.enrollmentId,
    session,
  };
}

export type IssuedChallenge = {
  challengeId: string;
  cookieName: string;
  /** チャレンジ cookie だけを載せた (セッション cookie を持たない) リクエスト headers。 */
  headers: Headers;
  /** ブラウザがそのまま送り返す署名済み cookie 値。 */
  signedValue: string;
};

const issuedChallengeIds: string[] = [];

// 実 store (buildLoginChallengeCookie) で発行し、cookie 素材をそのまま headers に載せる。
export async function issueTestChallenge(challenge: {
  userId: string;
  redirectUrl: string;
  method: ChallengeMethod;
}): Promise<IssuedChallenge> {
  const cookie = await buildLoginChallengeCookie(challenge);
  const challengeId = cookie.value.slice(0, cookie.value.lastIndexOf("."));
  issuedChallengeIds.push(challengeId);
  return {
    challengeId,
    cookieName: cookie.name,
    signedValue: cookie.value,
    headers: requestHeaders({ [cookie.name]: encodeURIComponent(cookie.value) }),
  };
}

// TTL 前に消し損ねた state が後続テストへ漏れないよう、テストが発行したチャレンジは明示的に消す。
export async function cleanupIssuedChallenges(): Promise<void> {
  const redis = await getRedis();
  await Promise.all(
    issuedChallengeIds.flatMap((id) => [redis.del(challengeKey(id)), redis.del(attemptsKey(id))]),
  );
  issuedChallengeIds.length = 0;
}

// revoke の実効性は DB では観測できない (secondaryStorage 構成では session 行が存在しない)。
// Redis 上の実体そのものを数える。
export async function countLiveSessions(tokens: string[]): Promise<number> {
  const redis = await getRedis();
  const entities = await Promise.all(tokens.map((token) => redis.get(token)));
  return entities.filter((entity) => entity !== null).length;
}

export async function deleteSessionEntities(tokens: string[]): Promise<void> {
  const redis = await getRedis();
  await Promise.all(tokens.map((token) => redis.del(token)));
}

// baseURL 未設定時 better-auth は request の origin を baseURL として使うため、テストは
// 一次認証を絶対 URL のリクエストで駆動する。
const AUTH_ORIGIN = "http://localhost:3100";

// local fallback のログ文言。e2e が同じ行からリンクを拾う契約なので、変えるなら送信側と同時に。
const MAGIC_LINK_LOG = "[TEST] Magic Link for";
export const WELCOME_EMAIL_LOG = "[TEST] Welcome email for";

export type PrimaryAuthLogin = { response: Response; location: URL | null; logs: string[] };

export type ObservedRun<T> = { value: T; logs: string[] };

// 通知メールは Background service の fire-and-forget。worker entry と同じ withWaitUntil で拾って
// 完走を待つことで、送信ログの観測が時間依存にならない。
export async function runObserving<T>(fn: () => Promise<T>): Promise<ObservedRun<T>> {
  const logs: string[] = [];
  const background: Promise<unknown>[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const value = await withWaitUntil((promise) => background.push(promise), fn);
    await Promise.allSettled(background);
    return { value, logs };
  } finally {
    console.log = originalLog;
  }
}

const handleWithBackgroundTasks = async (
  request: Request,
): Promise<{ response: Response; logs: string[] }> =>
  runObserving(() => auth.handler(request)).then(({ value, logs }) => ({
    response: value,
    logs,
  }));

export async function requestMagicLink(input: {
  email: string;
  callbackURL: string;
}): Promise<string> {
  const { logs } = await handleWithBackgroundTasks(
    new Request(`${AUTH_ORIGIN}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
    }),
  );
  const emailed = logs.find((line) => line.includes(MAGIC_LINK_LOG));
  if (!emailed) throw new Error(`no magic link was sent to ${input.email}`);
  return emailed.slice(emailed.indexOf("http"));
}

// リンクを踏む側だけを分けているのは、チャレンジ発行の失敗を注入するテストが「リンク発行は
// 成功させたまま発行だけ壊す」必要があるため。
export async function followMagicLink(link: string): Promise<PrimaryAuthLogin> {
  const { response, logs } = await handleWithBackgroundTasks(
    new Request(link, {
      headers: { "user-agent": TEST_USER_AGENT, "x-forwarded-for": TEST_CLIENT_IP },
      redirect: "manual",
    }),
  );
  const location = response.headers.get("location");
  return { response, location: location ? new URL(location) : null, logs };
}

// 一次認証の実 HTTP 経路。after-hook は一次認証が newSession を積んだ後にしか走らないため、
// 合成 ctx で代用すると「介入したつもり」のテストになる。
export async function loginWithMagicLink(input: {
  email: string;
  callbackURL: string;
}): Promise<PrimaryAuthLogin> {
  return followMagicLink(await requestMagicLink(input));
}

// ブラウザが次のリクエストで送り返す cookie に相当する headers。失効指示 (空値 / Max-Age=0) は
// ブラウザが破棄するので載せない。
export function browserCookieHeaders(response: Response): Headers {
  const pairs = response.headers
    .getSetCookie()
    .filter((cookie) => !/max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => pair.slice(pair.indexOf("=") + 1) !== "");
  return requestHeaders(
    Object.fromEntries(
      pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    ),
  );
}

// Sentry recorder は MFA 以外 (adapter / guard) の test も使うため src/__tests__ へ移した。
export { installSentryRecorder, type SentryCapture } from "../../__tests__/sentry-recorder";
