import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { makeSignature } from "better-auth/crypto";
import { Effect } from "effect";
import { auth } from "../../auth";
import { TtlStore } from "../../ttl-store-service";
import { resetDisableAttempts } from "../disable-attempt-budget";
import { activate, enroll } from "../totp";
import type { MfaTotpActor } from "../totp/contracts";
import {
  attemptsKey,
  challengeKey,
  type ChallengeMethod,
  openLoginChallenge,
} from "../totp/login-challenge";
import { observing } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";

// MFA の DB と TTL store の統合テストが共用する「本物のセッション、本物のチャレンジ、本物の TOTP」の組み立て。
// 状態を DB へ直接書き込んで作ると、暗号化された secret とコードの対応が伴わず、以降の検証がすべて偽陽性になる
// ため、生成はいずれも production と同じ経路 (internalAdapter / totp façade) を通す。
// 公開 API は Effect である。better-auth と raw の TTL store は DB 以外の Promise 境界で、呼び出し点で Effect.promise に包む
// (DB は TestDb だけを使う)。

// テスト実行時の鍵 ring の既定値 (.env に無くても bun test が単独で動くようにする)。
// 値は "0123456789abcdef0123456789abcdef" (32 byte) の base64 で、production と共有しない固定のダミーである。
process.env.MFA_TOTP_ENCRYPTION_KEYS ??= "v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_USER_AGENT = "mfa-integration-test";

// src/mfa/totp/totp-engine.ts の PERIOD と同じ値。検証は独立した実装 (@better-auth/utils) で行う (§10)。
const TOTP_PERIOD_SECONDS = 30;

// better-auth の署名付き cookie は `値.HMAC-SHA-256(値)` をパディング付きの標準 base64 で格納する。
// 署名付き値の形式は SIGNED_COOKIE_VALUE (発行者は Set-Cookie でこれを percent-encode する) で、
// src/__tests__/session-cookie-contract.test.ts が固定する。
const signCookieValue = (value: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const { secret } = await auth.$context;
    return `${value}.${await makeSignature(value, secret)}`;
  });

// 署名の末尾を書き換えても改ざんにならない。標準 base64 の最終文字は下位ビットがパディングで、
// atob が捨てるため復号後のバイト列が変わらず署名が通ってしまう。そのため、6 ビットすべてが有効な先頭文字を
// 差し替える。
export function tamperCookieSignature(signed: string): string {
  const separator = signed.lastIndexOf(".");
  const signature = signed.slice(separator + 1);
  const flippedHead = signature[0] === "A" ? "B" : "A";
  return `${signed.slice(0, separator)}.${flippedHead}${signature.slice(1)}`;
}

// ip と user-agent を常に付けて、audit payload の期待値が「未設定なら unknown」の分岐にならないようにする。
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

// 署名付き値 (percent-decode 後) の形式。署名は 44 文字 (HMAC-SHA-256 32 byte の標準 base64、末尾 `=`) である。
// better-call の getSignedCookie の受理条件 (末尾 44 文字が `=` で終わる) より狭い。Set-Cookie 上の値は両発行者とも
// これを percent-encode したものである (CONTEXT.md「session cookie」)。固定するのは
// src/__tests__/session-cookie-contract.test.ts である。
export const SIGNED_COOKIE_VALUE = /^[^%;]+\.[A-Za-z0-9+/]{43}=$/;

export type TestSession = { token: string; headers: Headers };

const sessionCookieName = (): Effect.Effect<string> =>
  Effect.promise(async () => (await auth.$context).authCookies.sessionToken.name);

const sessionHeaders = (token: string): Effect.Effect<Headers> =>
  Effect.gen(function* () {
    const name = yield* sessionCookieName();
    return requestHeaders({ [name]: yield* signCookieValue(token) });
  });

// secondaryStorage 構成ではセッションの実体が TTL store にしか無く、DB へ session 行を入れても
// getSession は解決できない。
export const createSessionFor = (userId: string): Effect.Effect<TestSession> =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(async () =>
      (await auth.$context).internalAdapter.createSession(userId),
    );
    return { token: session.token, headers: yield* sessionHeaders(session.token) };
  });

export const issuedSessionCookieCount = (forwarded: Headers): Effect.Effect<number> =>
  Effect.map(issuedSessionSetCookies(forwarded), (cookies) => cookies.length);

// 応答が発行した session cookie の Set-Cookie 行。失効指示 (空値や署名なしの値 / Max-Age=0) は
// 「発行された cookie」に数えない。
export const issuedSessionSetCookies = (forwarded: Headers): Effect.Effect<string[]> =>
  Effect.map(sessionCookieName(), (name) =>
    forwarded
      .getSetCookie()
      .filter((cookie) => cookie.startsWith(`${name}=`) && !/max-age=0(;|$)/i.test(cookie))
      .filter((cookie) => setCookieValue(cookie).lastIndexOf(".") > 0),
  );

// Set-Cookie 行の値部分 (先頭 pair の `=` 以降)。
export function setCookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0];
  return pair.slice(pair.indexOf("=") + 1);
}

export function actorOf(user: { id: string; email: string }): MfaTotpActor {
  return { id: user.id, email: user.email };
}

// DB の secret 列は鍵 ring で暗号化されており、平文の secret を得る経路は enroll が返す otpauth URI
// (secret パラメータは平文の base32) だけである。secret は ASCII のため、base32 から TextDecoder で往復しても値が変わらない。
export function secretFromTotpUri(totpUri: string): string {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`totp uri has no secret: ${totpUri}`);
  return new TextDecoder().decode(base32.decode(encoded));
}

export const totpCode = (secret: string, stepOffset = 0): Effect.Effect<string> =>
  Effect.promise(() => {
    const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: 6 });
    if (stepOffset === 0) return otp.totp();
    const counter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset;
    return otp.hotp(counter);
  });

// 固定の誤コードは 6 桁の一様分布に対して窓 5 本ぶんの確率で偶然一致し、まれに成功してしまう。
// 窓の前後まで含めて実際に生成し、それらを避ける。
export const wrongTotpCode = (secret: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const rejected = yield* Effect.all(
      [-2, -1, 0, 1, 2].map((offset) => totpCode(secret, offset)),
      { concurrency: "unbounded" },
    );
    for (let candidate = 0; candidate < 1000; candidate++) {
      const code = String(candidate).padStart(6, "0");
      if (!rejected.includes(code)) return code;
    }
    return yield* Effect.die(new Error("failed to find a code outside the verification window"));
  });

export const findMfaTotpRow = (userId: string) => TestDb.use((db) => db.readMfaTotp(userId));

export const countMfaTotpRows = (userId: string) =>
  findMfaTotpRow(userId).pipe(Effect.map((row) => (row ? 1 : 0)));

export const countRecoveryCodeRows = (userId: string) =>
  TestDb.use((db) => db.readRecoveryCodes(userId)).pipe(Effect.map((rows) => rows.length));

type EnabledMfaUser = {
  actor: MfaTotpActor;
  /** 認証アプリが持つ値に相当する平文 TOTP secret。 */
  secret: string;
  recoveryCodes: string[];
  enrollmentId: string;
  /** 有効化後も同じセッションのまま (rotate は行わない。ADR-0016 §4.3)。 */
  session: TestSession;
};

export const enableMfaFor = (user: { id: string; email: string }) =>
  Effect.gen(function* () {
    const session = yield* createSessionFor(user.id);
    const actor = actorOf(user);
    const enrolled = yield* enroll({ actor });
    const secret = secretFromTotpUri(enrolled.totpUri);
    // 前の step のコードで有効化し、現在の step 以降を後続の検証に残す (timestep は一方向にしか消費できないため)。
    yield* activate({
      actor,
      headers: session.headers,
      code: yield* totpCode(secret, -1),
      enrollmentId: enrolled.enrollmentId,
    });
    // 無効化の試行枠は user 単位で TTL store に 15 分残るが、seed の user id は実行のたびに同じである。
    // そのため「有効化直後は枠が空」であることを fixture 側で保証する。
    yield* resetDisableAttempts(user.id);
    return {
      actor,
      secret,
      recoveryCodes: enrolled.recoveryCodes,
      enrollmentId: enrolled.enrollmentId,
      session,
    } satisfies EnabledMfaUser;
  });

type IssuedChallenge = {
  challengeId: string;
  cookieName: string;
  /** チャレンジ cookie だけを持つ (セッション cookie を持たない) リクエスト headers。 */
  headers: Headers;
  /** ブラウザがそのまま送り返す署名済み cookie 値。 */
  signedValue: string;
};

const issuedChallengeIds: string[] = [];

// 実 store (openLoginChallenge) で発行し、cookie の材料をそのまま headers に入れる。
export const issueTestChallenge = (challenge: {
  userId: string;
  redirectUrl: string;
  method: ChallengeMethod;
}) =>
  openLoginChallenge(challenge).pipe(
    Effect.map((cookie): IssuedChallenge => {
      const challengeId = cookie.value.slice(0, cookie.value.lastIndexOf("."));
      issuedChallengeIds.push(challengeId);
      return {
        challengeId,
        cookieName: cookie.name,
        signedValue: cookie.value,
        headers: requestHeaders({ [cookie.name]: encodeURIComponent(cookie.value) }),
      };
    }),
  );

// チャレンジの TTL store 上の状態 (本体と試行枠) を消す。TTL 切れを待たず、テストが発行した分を明示的に片付ける。
const deleteChallengeState = (challengeIds: readonly string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(
      challengeIds.flatMap((id) => [challengeKey(id), attemptsKey(id)]),
      (key) => ttlStore.delete(key),
      { concurrency: "unbounded" },
    );
  });

// TTL 切れの前に消し損ねた状態が後続テストへ漏れないよう、テストが発行したチャレンジは明示的に消す。
export const cleanupIssuedChallenges = () =>
  deleteChallengeState(issuedChallengeIds).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        issuedChallengeIds.length = 0;
      }),
    ),
  );

// revoke の実効性は DB では観測できない (secondaryStorage 構成では session 行が存在しない)。
// TTL store 上の実体そのものを数える。
export const countLiveSessions = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    const entities = yield* Effect.forEach(tokens, (token) => ttlStore.get(token), {
      concurrency: "unbounded",
    });
    return entities.filter((entity) => entity !== null).length;
  });

export const deleteSessionEntities = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(tokens, (token) => ttlStore.delete(token), { concurrency: "unbounded" });
  });

// baseURL が未設定の時、better-auth は request の origin を baseURL として使うため、テストは
// 一次認証を絶対 URL のリクエストで行う。
const AUTH_ORIGIN = "http://localhost:3100";

// local fallback のログ文言。e2e が同じ行からリンクを取り出す契約なので、変えるなら送信側と同時に変える。
const MAGIC_LINK_LOG = "[TEST] Magic Link for";
export const WELCOME_EMAIL_LOG = "[TEST] Welcome email for";

type PrimaryAuthLogin = { response: Response; location: URL | null; logs: string[] };

// 通知メールは Background service の fire-and-forget である。worker entry と同じ withWaitUntil で受け取って
// 完了を待つことで、送信ログの観測が時間に依存しなくなる。
const handleWithBackgroundTasks = (request: Request) =>
  observing(Effect.promise(() => auth.handler(request))).pipe(
    Effect.map(({ value, logs }) => ({ response: value, logs })),
  );

export const requestMagicLink = (input: { email: string; callbackURL: string }) =>
  Effect.gen(function* () {
    const { logs } = yield* handleWithBackgroundTasks(
      new Request(`${AUTH_ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
      }),
    );
    const emailed = logs.find((line) => line.includes(MAGIC_LINK_LOG));
    if (!emailed) return yield* Effect.die(new Error(`no magic link was sent to ${input.email}`));
    return emailed.slice(emailed.indexOf("http"));
  });

// リンクを開く側だけを分けているのは、チャレンジ発行の失敗を注入するテストが「リンクの発行は
// 成功させたままチャレンジの発行だけを壊す」必要があるためである。
export const followMagicLink = (link: string) =>
  handleWithBackgroundTasks(
    new Request(link, {
      headers: { "user-agent": TEST_USER_AGENT, "x-forwarded-for": TEST_CLIENT_IP },
      redirect: "manual",
    }),
  ).pipe(
    Effect.map(({ response, logs }): PrimaryAuthLogin => {
      const location = response.headers.get("location");
      return { response, location: location ? new URL(location) : null, logs };
    }),
  );

// 一次認証の実 HTTP 経路。after-hook は一次認証が newSession を設定した後にしか走らないため、
// 合成した ctx で代用すると「介入したつもり」のテストになる。
export const loginWithMagicLink = (input: { email: string; callbackURL: string }) =>
  requestMagicLink(input).pipe(Effect.flatMap(followMagicLink));

// ブラウザが次のリクエストで送り返す cookie に相当する headers。失効指示 (空値 / Max-Age=0) は
// ブラウザが破棄するので含めない。
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

// 公開 API が Effect であることの型 assert (AC-218)。
const _mfaTestApi = {
  enableMfaFor,
  createSessionFor,
  issueTestChallenge,
  cleanupIssuedChallenges,
  countLiveSessions,
  deleteSessionEntities,
  requestMagicLink,
  followMagicLink,
  loginWithMagicLink,
  observing,
} satisfies Record<string, (...args: never[]) => Effect.Effect<unknown, unknown, unknown>>;

// Sentry recorder は MFA 以外 (adapter / guard) のテストも使うため src/__tests__ へ移した。
export { installSentryRecorder } from "../../__tests__/sentry-recorder";
