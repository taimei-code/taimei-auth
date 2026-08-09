import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { spyOn } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, twoFactor, verification } from "@/db/schema";
import { auth } from "../../auth";
import { withWaitUntil } from "../../background";
import type { Actor } from "../../membership/guard/core";
import { getRedis } from "../../redis";
import { setSentryBackend, type CaptureContext } from "../../sentry";
import { activate } from "../activate";
import { issueChallenge, type ChallengeMethod } from "../challenge-store";
import { enroll } from "../enroll";

// MFA の DB/Redis 統合テストが共用する「本物のセッション・本物のチャレンジ・本物の TOTP」の組み立て。
// 状態を DB へ直接捏造すると、プラグインが持つ暗号化 secret とコードの対応が伴わず以降の検証が
// すべて偽陽性になるため、生成はいずれも production と同じ経路 (internalAdapter / use-case) を通す。
//
// このファイルはチャレンジ cookie 名と challengeId 接頭辞の文字列リテラルを持たない。
// challenge-store が createAuthCookie / setSignedCookie 越しに渡す値を観測して使うことで、
// 内部形式の封じ込めを見る静的 tripwire (containment.test.ts) の対象を増やさない。

export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_USER_AGENT = "mfa-integration-test";

// src/auth.ts の totpOptions.period と同値。プラグインに検証窓の option が無く、窓の広さは
// @better-auth/utils の既定 (±1 step) にしか書かれていないため、テストは step を自分で刻む。
const TOTP_PERIOD_SECONDS = 30;

export type TwoFactorRow = typeof twoFactor.$inferSelect;

// better-call の署名付き cookie は `値.HMAC-SHA-256(値)` をパディング付き標準 base64 で載せる
// (非互換な署名 scheme との違いは src/mfa/challenge-store.ts のコメントにある)。
export async function signCookieValue(value: string): Promise<string> {
  const { secret } = await auth.$context;
  return `${value}.${await makeSignature(value, secret)}`;
}

// 署名の**末尾**を書き換えても改ざんにならない。標準 base64 の最終文字は下位ビットがパディングで、
// atob が捨てるため復号後のバイト列が変わらず署名が通ってしまう (実測: 6 桁中 4/64 の確率で
// テストが偽陰性になった)。6 ビットすべてが有効な先頭文字を差し替える。
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

// activate / disable / チャレンジ通過はいずれもセッションを rotate するため、続きの操作は
// 転送された cookie で組み直さないと直前に消えた token を使うことになる。
export async function sessionTokenFromForwarded(forwarded: Headers): Promise<string | undefined> {
  const { authCookies } = await auth.$context;
  return issuedSessionCookieValues(forwarded, authCookies.sessionToken.name)
    .map((value) => value.slice(0, value.lastIndexOf(".")))
    .map(decodeURIComponent)
    .at(0);
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

export function actorOf(
  user: { id: string; email: string },
  overrides: { twoFactorEnabled?: boolean; lastUsedCompanyId?: string | null } = {},
): Actor {
  return {
    id: user.id,
    email: user.email,
    lastUsedCompanyId: overrides.lastUsedCompanyId ?? null,
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
  };
}

// DB の secret 列は AUTH_SECRET 由来の鍵で暗号化されており、平文 secret を得る経路は
// enroll が返す otpauth URI (secret パラメータは平文の base32) だけ。
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

export const currentTotpStep = (): number => Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));

// TOTP の刻みをまたぐと offset 指定で作ったコードが 1 つずれ、窓の内外が入れ替わる。次の step の
// 頭まで待って観測の持ち時間を最大化する (待つだけでは足りないので、跨いだかどうかは
// currentTotpStep の前後比較で検出すること)。
export async function awaitNextTotpStep(): Promise<void> {
  const periodMs = TOTP_PERIOD_SECONDS * 1000;
  await new Promise((resolve) => setTimeout(resolve, periodMs - (Date.now() % periodMs) + 100));
}

// 固定の誤コードは 6 桁の一様分布に対し窓 5 本ぶん = 100 万分の 5 の確率で偶然一致し、
// 間欠的に緑になる。窓の前後まで含めて実際に生成し、それらを避ける。
export async function wrongTotpCode(secret: string): Promise<string> {
  const rejected = await Promise.all([-2, -1, 0, 1, 2].map((offset) => totpCode(secret, offset)));
  for (let candidate = 0; candidate < 1000; candidate++) {
    const code = String(candidate).padStart(6, "0");
    if (!rejected.includes(code)) return code;
  }
  throw new Error("failed to find a code outside the verification window");
}

export function findTwoFactorRow(userId: string): Promise<TwoFactorRow | undefined> {
  return db
    .select()
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .then((rows) => rows.at(0));
}

export function countTwoFactorRows(userId: string): Promise<number> {
  return db
    .select()
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .then((rows) => rows.length);
}

export type EnabledMfaUser = {
  actor: Actor;
  /** 認証アプリが持つ値に相当する平文 TOTP secret。 */
  secret: string;
  recoveryCodes: string[];
  /** 有効化で rotate した後の現行セッション。 */
  session: TestSession;
};

export async function enableMfaFor(user: { id: string; email: string }): Promise<EnabledMfaUser> {
  const session = await createSessionFor(user.id);
  const enrolled = await enroll(actorOf(user), session.headers);
  if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error}`);

  const secret = secretFromTotpUri(enrolled.totpUri);
  const activated = await activate({
    actor: actorOf(user),
    headers: session.headers,
    code: await totpCode(secret),
  });
  if (!activated.ok) throw new Error(`activate failed: ${activated.error}`);

  const rotatedToken = await sessionTokenFromForwarded(activated.forwardedHeaders);
  if (!rotatedToken) throw new Error("activate did not forward a session cookie");

  return {
    actor: actorOf(user, { twoFactorEnabled: true }),
    secret,
    recoveryCodes: enrolled.recoveryCodes,
    session: { token: rotatedToken, headers: await sessionHeaders(rotatedToken) },
  };
}

export type IssuedChallenge = {
  challengeId: string;
  cookieName: string;
  cookieMaxAgeSeconds: number | undefined;
  issuedAt: number;
  /** チャレンジ cookie だけを載せた (セッション cookie を持たない) リクエスト headers。 */
  headers: Headers;
};

// issueChallenge が要求する機能だけを備えた ctx stub を渡し、発行された challengeId と cookie 属性を
// 観測できる形で返す。プラグイン殻を経由しないので、チャレンジ状態そのものを見るテストが
// 一次認証のセットアップから独立する。
export async function issueTestChallenge(challenge: {
  userId: string;
  redirectUrl: string;
  method: ChallengeMethod;
}): Promise<IssuedChallenge> {
  const authContext = await auth.$context;
  let captured: { name: string; value: string; maxAge: number | undefined } | undefined;

  const issuedAt = Date.now();
  await issueChallenge(
    {
      context: {
        secret: authContext.secret,
        createAuthCookie: (name, overrides) => authContext.createAuthCookie(name, overrides),
        internalAdapter: authContext.internalAdapter,
      },
      setSignedCookie: async (name, value, _secret, options) => {
        captured = { name, value, maxAge: (options as { maxAge?: number } | undefined)?.maxAge };
      },
    },
    challenge,
  );

  if (!captured) throw new Error("issueChallenge did not set a challenge cookie");
  issuedChallengeIds.push(captured.value);
  return {
    challengeId: captured.value,
    cookieName: captured.name,
    cookieMaxAgeSeconds: captured.maxAge,
    issuedAt,
    headers: requestHeaders({ [captured.name]: await signCookieValue(captured.value) }),
  };
}

export async function challengeAndSessionHeaders(
  challenge: IssuedChallenge,
  sessionToken: string,
): Promise<Headers> {
  const { authCookies } = await auth.$context;
  return requestHeaders({
    [challenge.cookieName]: await signCookieValue(challenge.challengeId),
    [authCookies.sessionToken.name]: await signCookieValue(sessionToken),
  });
}

// 1 チャレンジが書く verification value の identifier 群。challengeId を接尾に持つことだけを
// 手掛かりにするので、キー名の接頭辞リテラルをテスト側に持ち込まずに済む。
export function findChallengeIdentifiers(challengeId: string): Promise<string[]> {
  return db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(like(verification.identifier, `%${challengeId}`))
    .then((rows) => rows.map((row) => row.identifier));
}

// プラグインが所有する試行カウンタ。完了マーカー (challengeId 自身) でも challenge-store の
// 補助キー (mfa- 接頭) でもない 1 本として差分で特定する。
export async function findAttemptsIdentifier(challengeId: string): Promise<string> {
  const candidates = (await findChallengeIdentifiers(challengeId)).filter(
    (identifier) => identifier !== challengeId && !identifier.startsWith("mfa-"),
  );
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one attempts identifier, got ${candidates.join(", ")}`);
  }
  return candidates[0];
}

const issuedChallengeIds: string[] = [];

// verification 行は TTL 切れでも DB に残るため、テストが作ったチャレンジ状態は明示的に消す。
export async function cleanupIssuedChallenges(): Promise<void> {
  const identifiers = await Promise.all(issuedChallengeIds.map(findChallengeIdentifiers));
  await Promise.all(identifiers.flat().map(deleteVerification));
  issuedChallengeIds.length = 0;
}

export type StoredVerification = { value: string; expiresAt: Date };

export async function findVerification(
  identifier: string,
): Promise<StoredVerification | undefined> {
  const { internalAdapter } = await auth.$context;
  const record = await internalAdapter.findVerificationValue(identifier);
  return record ? { value: record.value, expiresAt: new Date(record.expiresAt) } : undefined;
}

export async function deleteVerification(identifier: string): Promise<void> {
  const { internalAdapter } = await auth.$context;
  await internalAdapter.deleteVerificationByIdentifier(identifier);
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
// 一次認証を絶対 URL のリクエストで駆動する (auth.api 経由だと baseURL が空で magic link を組めない)。
const AUTH_ORIGIN = "http://localhost:3100";

// local fallback のログ文言。e2e が同じ行からリンクを拾う契約なので、変えるなら送信側と同時に。
const MAGIC_LINK_LOG = "[TEST] Magic Link for";
export const WELCOME_EMAIL_LOG = "[TEST] Welcome email for";

export type PrimaryAuthLogin = { response: Response; location: URL | null; logs: string[] };

export type ObservedRun<T> = { value: T; logs: string[] };

// audit 記帳と通知メールは runBackground の fire-and-forget。worker entry と同じ withWaitUntil で
// 拾って完走を待つことで、記帳の観測が時間依存にならない。メール送信は local fallback が
// console へ落とすので、同じ捕捉でついでに拾う (実送信の確認は手動台帳の担当)。
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
// 成功させたまま検証だけ壊す」必要があるため (発行側にも verification value の書き込みがある)。
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

// 一次認証の実 HTTP 経路。プラグイン殻の after-hook は一次認証が newSession を積んだ後にしか
// 走らないため、合成 ctx で代用すると「介入したつもり」のテストになる。
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

// audit の書き込みだけを落とす注入。db.insert を丸ごと潰すとプラグイン側の書き込みまで巻き込み、
// 「記帳が失敗しても手続きは完走する」ではなく「手続きごと失敗した」を観測してしまうため、
// 対象テーブルで絞る。
export async function withFailingAuditWrite<T>(run: () => Promise<T>): Promise<T> {
  const insert = db.insert.bind(db);
  const failing = spyOn(db, "insert").mockImplementation(((
    table: Parameters<typeof db.insert>[0],
  ) => {
    if (table === auditLog) throw new Error("audit store unavailable");
    return insert(table);
  }) as typeof db.insert);
  try {
    return await run();
  } finally {
    failing.mockRestore();
  }
}

export type SentryCapture = { message: string; context?: CaptureContext };

// MFA の失敗経路は「握り潰さず観測へ回す」ことが仕様の一部 (ロック急増の検知信号 / 不変条件破れの
// 検出) なので、captureMessage / captureException の発火はテストの検証対象になる。backend は
// module-global のため、install した test file は必ず restore して後続ファイルへ spy を漏らさない。
export function installSentryRecorder(): {
  messages: SentryCapture[];
  exceptions: SentryCapture[];
  reset(): void;
  restore(): void;
} {
  const messages: SentryCapture[] = [];
  const exceptions: SentryCapture[] = [];
  setSentryBackend({
    captureMessage: (message, context) => messages.push({ message, context }),
    captureException: (error, context) => exceptions.push({ message: String(error), context }),
  });
  return {
    messages,
    exceptions,
    reset: () => {
      messages.length = 0;
      exceptions.length = 0;
    },
    restore: () =>
      setSentryBackend({
        captureException: (error) => console.error("[sentry:noop] captureException", error),
        captureMessage: (message, context) =>
          console.warn("[sentry:noop] captureMessage", message, context?.tags),
      }),
  };
}
